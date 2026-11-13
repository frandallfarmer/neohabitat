#!/bin/bash
# Install the FUDCo/Elko commit named by pom.xml's <elko.commit> into the
# local Maven repository as org.elko:elkoserver:<commit>.
#
# JitPack cannot build that commit: it has no jitpack.yml, so the build uses
# JDK 8, which cannot compile Elko (--release 17) or read selectable-tls
# 0.1.0 (class file version 61). There is no consumer-side JitPack setting
# to select the JDK. Cloning the pinned commit avoids a fork whose only
# extra file is jitpack.yml.
#
# No-ops when that exact jar is already installed. The Dockerfile runs this
# while building the image; the run script runs it again so a container
# start still resolves Elko if the local repo is empty.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
POM="$ROOT/pom.xml"

# `java -version` is not enough. CentOS's java-21-openjdk package is a JRE:
# Maven then runs on that JRE (or the Java 17 JRE it pulls itself) and
# javac fails with "release version 17 not supported". Require a JDK.
javac_ok() {
  command -v javac >/dev/null 2>&1 && javac -version 2>&1 | grep -Eq 'javac (1[7-9]|[2-9][0-9])'
}
if ! javac_ok; then
  shopt -s nullglob
  for candidate in \
      /usr/lib/jvm/java-21-openjdk \
      /usr/lib/jvm/java-21-openjdk-* \
      /usr/lib/jvm/java-17-openjdk \
      /usr/lib/jvm/java-17-openjdk-*; do
    if [[ -x "$candidate/bin/javac" ]]; then
      export JAVA_HOME="$candidate"
      export PATH="$JAVA_HOME/bin:$PATH"
      break
    fi
  done
  shopt -u nullglob
fi
if ! javac_ok; then
  echo "install-elko: Elko needs a JDK 17 or newer (javac). The JRE package is not enough." >&2
  java -version >&2 || true
  exit 1
fi

COMMIT="$(sed -n 's/^[[:space:]]*<elko.commit>\([^<]*\)<\/elko.commit>[[:space:]]*$/\1/p' "$POM")"
if ! [[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "install-elko: <elko.commit> in $POM is not a 40-character sha (got '${COMMIT:-}')" >&2
  exit 1
fi

DEST="$HOME/.m2/repository/org/elko/elkoserver/${COMMIT}"
if [[ -f "$DEST/elkoserver-${COMMIT}.jar" && -f "$DEST/elkoserver-${COMMIT}.pom" ]]; then
  echo "install-elko: ${COMMIT} already installed"
  exit 0
fi

command -v git >/dev/null || { echo "install-elko: git is required" >&2; exit 1; }
command -v mvn >/dev/null || { echo "install-elko: mvn is required" >&2; exit 1; }
command -v make >/dev/null || { echo "install-elko: make is required (Elko generates BuildVersion.java with make)" >&2; exit 1; }

src="$(mktemp -d)"
trap 'rm -rf "$src"' EXIT

echo "install-elko: fetching FUDCo/Elko ${COMMIT}"
git -C "$src" init -q
git -C "$src" remote add origin https://github.com/FUDCo/Elko.git
git -C "$src" fetch --depth 1 origin "$COMMIT"
git -C "$src" checkout -q --detach FETCH_HEAD
chmod +x "$src/ServerCore/build/gen_templates.sh"

# Elko's own pom is 2.0.4-SNAPSHOT. Publish under the commit sha so the
# NeoHabitat dependency pin and the installed artifact are the same version.
mvn -B -ntp -f "$src/pom.xml" \
  org.codehaus.mojo:versions-maven-plugin:2.16.2:set \
  -DnewVersion="$COMMIT" -DgenerateBackupPoms=false
mvn -B -ntp -f "$src/pom.xml" install -DskipTests

if [[ ! -f "$DEST/elkoserver-${COMMIT}.jar" ]]; then
  echo "install-elko: mvn install did not produce $DEST/elkoserver-${COMMIT}.jar" >&2
  exit 1
fi
echo "install-elko: installed org.elko:elkoserver:${COMMIT}"
