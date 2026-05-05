package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/cloudflare/tableflip"
	"github.com/coreos/go-systemd/v22/daemon"
	"github.com/frandallfarmer/neohabitat/bridge_v2/bridge"
	"github.com/frandallfarmer/neohabitat/bridge_v2/observability"
	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

var buildVersion = "dev"

// stringSliceFlag is a flag.Value that accumulates repeated occurrences
// of the same flag into a slice. Lets the bridge accept several
// --listen=... flags so one stateful process can serve every host port
// (1337/1986/2026 historically) without splitting session state.
type stringSliceFlag []string

func (s *stringSliceFlag) String() string { return strings.Join(*s, ",") }
func (s *stringSliceFlag) Set(v string) error {
	*s = append(*s, v)
	return nil
}

var initialContext = flag.String("context", "context-Downtown_5f", "Parameter for entercontext for unknown users")
var listenAddrs stringSliceFlag
var elko = flag.String("elko.host", "127.0.0.1:2018", "Host:Port of Habiproxy (or Elko directly)")
var mongo = flag.String("mongo.host", "mongodb://127.0.0.1:27017", "MongoDB server host")
var mongoDatabase = flag.String("mongo.db", "elko", "Database within MongoDB to use")
var mongoCollection = flag.String("mongo.collection", "odb", "Collection within MongoDB to use")
var rate = flag.Int("rate", 1200, "Data rate in bits-per-second for transmitting to C64 clients")
var logLevel = flag.String("log.level", "INFO", "Log level for logger")
var qlinkMode = flag.Bool("qlink", false, "Listen for Habilink/QLink clients")
var otelEnabled = flag.Bool("otel.enabled", false, "Enable OpenTelemetry export")
var graceful = flag.Bool("graceful", false, "Enable graceful restart via SIGHUP (tableflip). Production only.")

const snapshotEnvVar = "BRIDGE_SNAPSHOT_PATH"

func setLogLevel(level string) {
	switch lowerLevel := strings.ToLower(level); lowerLevel {
	case "info":
		zerolog.SetGlobalLevel(zerolog.InfoLevel)
	case "debug":
		zerolog.SetGlobalLevel(zerolog.DebugLevel)
	case "error":
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	case "warn":
		zerolog.SetGlobalLevel(zerolog.WarnLevel)
	case "trace":
		zerolog.SetGlobalLevel(zerolog.TraceLevel)
	default:
		zerolog.SetGlobalLevel(zerolog.ErrorLevel)
	}
}

func main() {
	flag.Var(&listenAddrs, "listen", "Address (Host:Port) to listen on. May be specified multiple times to bind several ports in one process; sessions accepted on any listener share the same in-memory state.")
	flag.Parse()
	if len(listenAddrs) == 0 {
		listenAddrs = stringSliceFlag{"127.0.0.1:1337"}
	}
	setLogLevel(*logLevel)
	if !*otelEnabled {
		log.Logger = log.Output(zerolog.ConsoleWriter{
			Out:        os.Stderr,
			TimeFormat: "3:04:05PM",
			FormatTimestamp: func(i interface{}) string {
				return "\033[35m" + fmt.Sprintf("%s", i) + "\033[0m"
			},
		})
	}

	var otelShutdown func(context.Context) error
	if *otelEnabled {
		ctx := context.Background()
		var err error
		otelShutdown, err = observability.Init(ctx, "bridge_v2", buildVersion)
		if err != nil {
			log.Fatal().Err(err).Msg("Could not initialize OpenTelemetry")
		}
		log.Info().Str("version", buildVersion).Msg("OpenTelemetry initialized")
	}

	if *graceful {
		runWithTableflip(otelShutdown)
	} else {
		runSimple(otelShutdown)
	}
}

func newBridge() *bridge.Bridge {
	return bridge.NewBridge(
		*initialContext, []string(listenAddrs), *elko, *mongo,
		*mongoDatabase, *mongoCollection, *rate, *qlinkMode,
	)
}

func runSimple(otelShutdown func(context.Context) error) {
	habitatBridge := newBridge()
	habitatBridge.Start()

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	<-sigCh
	log.Info().Msg("Received SIGINT, shutting down...")
	habitatBridge.Close()
	shutdownOtel(otelShutdown)
}

func runWithTableflip(otelShutdown func(context.Context) error) {
	upg, err := tableflip.New(tableflip.Options{})
	if err != nil {
		log.Fatal().Err(err).Msg("Could not initialize tableflip upgrader")
	}
	defer upg.Stop()

	habitatBridge := newBridge()
	listeners := make([]net.Listener, len(listenAddrs))

	// Check if we're restoring from a parent's snapshot.
	restoring := os.Getenv(snapshotEnvVar) != ""

	if restoring {
		// The child inherited the parent's listeners via tableflip.
		// Retrieve and close each — they're still bound to their
		// configured ports and would block the TCP_REPAIR bind.
		for _, addr := range listenAddrs {
			if inheritedLn, _ := upg.Fds.Listen("tcp", addr); inheritedLn != nil {
				inheritedLn.Close()
			}
		}

		// Now create fresh listeners (one per configured address) with
		// SO_REUSEPORT so they coexist with the restored connections.
		lc := net.ListenConfig{
			Control: func(network, address string, c syscall.RawConn) error {
				return c.Control(func(fd uintptr) {
					syscall.SetsockoptInt(int(fd), syscall.SOL_SOCKET, 0xf /* SO_REUSEPORT */, 1)
				})
			},
		}
		for i, addr := range listenAddrs {
			ln, lerr := lc.Listen(context.Background(), "tcp", addr)
			if lerr != nil {
				log.Fatal().Err(lerr).Str("addr", addr).Msg("Could not create listener for restore")
			}
			log.Info().Str("addr", ln.Addr().String()).Msg("Created fresh listener for restore")
			listeners[i] = ln
			// CRUCIAL: register the fresh listener with tableflip so the
			// *next* upgrade cycle's child can inherit it via Fds.Listen.
			// Without this the next reload's plain-path child gets no
			// inherited fd, falls through to a fresh bind, and fails
			// with "address already in use" because the parent (us)
			// still holds the port. Symptom in production: every
			// subsequent SIGHUP after a session-bearing reload would
			// fail with the new child exiting status 1 immediately.
			if aerr := upg.Fds.AddListener("tcp", addr, ln.(tableflip.Listener)); aerr != nil {
				log.Error().Err(aerr).Str("addr", addr).Msg("Could not register restored listener with tableflip; future upgrades will not inherit it")
			}
		}

		// Restore sessions from manifest + inherited fds
		manifest, merr := bridge.ReadManifest(os.Getenv(snapshotEnvVar))
		if merr != nil {
			log.Error().Err(merr).Msg("Could not read manifest; starting fresh")
		} else {
			for _, snap := range manifest.Sessions {
				f, ferr := upg.Fds.File("client-" + snap.SessionID)
				if ferr != nil || f == nil {
					log.Error().AnErr("err", ferr).Str("session", snap.SessionID).
						Msg("Cannot retrieve client fd; skipping")
					continue
				}
				cc, cerr := net.FileConn(f)
				f.Close()
				if cerr != nil {
					log.Error().Err(cerr).Str("session", snap.SessionID).
						Msg("Cannot wrap client fd; skipping")
					continue
				}
				if cc == nil || cc.RemoteAddr() == nil {
					log.Error().Str("session", snap.SessionID).
						Bool("cc_nil", cc == nil).
						Msg("FileConn returned conn with nil RemoteAddr; skipping")
					if cc != nil {
						cc.Close()
					}
					continue
				}
				ec, eerr := net.DialTimeout("tcp", *elko, 5*time.Second)
				if eerr != nil {
					cc.Close()
					log.Error().Err(eerr).Str("session", snap.SessionID).
						Msg("Cannot connect to Elko; skipping")
					continue
				}
				sess := bridge.RestoreSession(habitatBridge, &snap, cc, ec)
				habitatBridge.RegisterRestoredSession(sess)
				sess.StartRestored()
				log.Info().Str("session", snap.SessionID).
					Str("avatar", snap.UserName).
					Msg("Session restored via TCP_REPAIR")
			}
			os.Remove(os.Getenv(snapshotEnvVar))
		}
	} else {
		// First run or normal tableflip cycle: get one listener per
		// configured address from tableflip's Fds (inherited or fresh).
		for i, addr := range listenAddrs {
			ln, lerr := upg.Fds.Listen("tcp", addr)
			if lerr != nil {
				log.Fatal().Err(lerr).Str("addr", addr).Msg("Could not obtain listener")
			}
			listeners[i] = ln
		}
	}

	habitatBridge.SetListeners(listeners)

	// SIGHUP: close listeners, TCP_REPAIR save+restore, pass fds, upgrade
	go func() {
		sig := make(chan os.Signal, 1)
		signal.Notify(sig, syscall.SIGHUP)
		for range sig {
			log.Info().Msg("SIGHUP received, starting graceful upgrade...")

			// 1. Snapshot sessions (quiesce at frame boundary).
			// SnapshotAllWithTCP closes every listener registered with
			// the bridge before TCP_REPAIR bind, then walks /proc to
			// force-close any tableflip-dup'd fds for the same ports.
			manifest, serr := habitatBridge.SnapshotAllWithTCP()
			if serr != nil {
				log.Error().Err(serr).Msg("Snapshot failed; aborting upgrade")
				continue
			}

			// 2. Write manifest + arm the restore path *only* when
			// there is actually something to restore. With zero
			// sessions, SnapshotAllWithTCP returns early without
			// closing the parent's listener (the listener teardown
			// lives in phase 2 of TCP_REPAIR). If we still set
			// snapshotEnvVar, the child takes the restore branch,
			// tries to bind a fresh listener with SO_REUSEPORT on
			// *:2026, and fails with "address already in use" because
			// the parent's listener (no SO_REUSEPORT) still holds
			// the port. Symptom in logs:
			//   "Could not create listener for restore"
			//   "child pid=N exited: exit status 1 / Upgrade failed"
			// Falling back to the plain tableflip path lets the child
			// inherit the listener via Fds.Listen() and start cleanly.
			if len(manifest.Sessions) > 0 {
				snapPath := filepath.Join(os.TempDir(),
					fmt.Sprintf("bridge_v2_handoff_%d.json", os.Getpid()))
				if werr := bridge.WriteManifest(snapPath, manifest); werr != nil {
					log.Error().Err(werr).Msg("Could not write manifest")
					continue
				}
				os.Setenv(snapshotEnvVar, snapPath)

				// 3. Pass restored client fds to child (blocking mode,
				//    won't register with child's epoll in newParent)
				for _, snap := range manifest.Sessions {
					fd := snap.RestoredClientFd()
					if fd < 0 {
						continue
					}
					f := os.NewFile(uintptr(fd), "client-"+snap.SessionID)
					if err := upg.Fds.AddFile("client-"+snap.SessionID, f); err != nil {
						log.Error().Err(err).Str("session", snap.SessionID).
							Msg("AddFile failed")
					}
					f.Close()
				}

				// 4. Upgrade (restore-armed path)
				if uerr := upg.Upgrade(); uerr != nil {
					log.Error().Err(uerr).Msg("Upgrade failed")
					os.Remove(snapPath)
					os.Unsetenv(snapshotEnvVar)
					continue
				}
			} else {
				// 4b. Upgrade (plain path — no sessions to hand off).
				log.Info().Msg("No sessions to snapshot; using plain tableflip upgrade")
				// Defensive: ensure no stale env var from a prior cycle.
				os.Unsetenv(snapshotEnvVar)
				if uerr := upg.Upgrade(); uerr != nil {
					log.Error().Err(uerr).Msg("Upgrade failed")
					continue
				}
			}

			log.Info().Int("sessions", len(manifest.Sessions)).
				Msg("Upgrade triggered; child will restore via TCP_REPAIR")
		}
	}()

	habitatBridge.Start()

	log.Info().Msg("Ready")
	// Tell systemd we're ready AND that the main PID is now this
	// process. Critical on the SIGHUP path: tableflip forked us as a
	// child of the previous bridge_v2, but systemd's Type=notify still
	// thinks the *parent* is the main PID. Without this, when the
	// parent exits cleanly post-Ready(), systemd sees its tracked main
	// PID die and (with KillMode=control-group, the default) kills the
	// entire cgroup — including us, the new child. Symptom on the
	// made: bridge_v2.service goes "Deactivated successfully" right
	// after "Child restored sessions; parent exiting", and the child
	// dies along with the parent.
	//
	// SdNotify is a no-op when NOTIFY_SOCKET isn't set (i.e., when we
	// aren't running under systemd Type=notify), so it's safe in dev,
	// docker, and the simple non-graceful path.
	notifyMsg := fmt.Sprintf("READY=1\nMAINPID=%d", os.Getpid())
	if sent, nerr := daemon.SdNotify(false, notifyMsg); nerr != nil {
		log.Warn().Err(nerr).Msg("sd_notify failed (only matters under systemd Type=notify)")
	} else if sent {
		log.Info().Int("pid", os.Getpid()).Msg("sd_notify: claimed MAINPID + READY=1")
	}
	if err := upg.Ready(); err != nil {
		log.Fatal().Err(err).Msg("Could not signal readiness to parent")
	}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt)
	select {
	case <-sigCh:
		log.Info().Msg("Received SIGINT, shutting down...")
		habitatBridge.Close()
		shutdownOtel(otelShutdown)
	case <-upg.Exit():
		log.Info().Msg("Child restored sessions; parent exiting")
	}
}

func shutdownOtel(shutdown func(context.Context) error) {
	if shutdown != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := shutdown(ctx); err != nil {
			log.Error().Err(err).Msg("OpenTelemetry shutdown error")
		}
	}
}
