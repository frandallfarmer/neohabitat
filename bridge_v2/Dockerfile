# bridge_v2 — Go reimplementation of the Habitat<->Elko bridge.
#
# Multi-stage build: a golang:1.25 builder produces a static linux/amd64
# binary, which we then drop into a tiny distroless/static runtime image.

FROM golang:1.25 AS build

WORKDIR /src

# Pull dependencies first so layer caching survives source-only changes.
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source.
COPY . .

# Build a fully static binary so we can run it on distroless/static.
ENV CGO_ENABLED=0
RUN go build -trimpath -ldflags="-s -w" -o /out/bridge_v2 .

# ---------------------------------------------------------------------------
# Runtime stage.
FROM gcr.io/distroless/static-debian12:nonroot

WORKDIR /

COPY --from=build /out/bridge_v2 /bridge_v2

# Default port the bridge listens on inside the container. The host port is
# set in docker-compose.yml.
EXPOSE 2026

ENTRYPOINT ["/bridge_v2"]
