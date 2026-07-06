FROM golang:1.25-alpine AS go-builder

RUN apk add --no-cache git ca-certificates
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN rm -rf internal/setup/web \
  && mkdir -p internal/setup/web \
  && printf '%s\n' '<!doctype html><html><head><meta charset="utf-8"><title>FastClaw API</title></head><body>FastClaw API</body></html>' > internal/setup/web/index.html

ARG VERSION=dev
ARG COMMIT=unknown
RUN CGO_ENABLED=0 go build \
  -ldflags "-s -w -X main.version=${VERSION} -X main.commit=${COMMIT}" \
  -o /fastclaw ./cmd/fastclaw

FROM alpine:3.21

RUN apk add --no-cache ca-certificates tzdata
COPY --from=go-builder /fastclaw /usr/local/bin/fastclaw

ENV FASTCLAW_HOME=/data/.fastclaw \
  HOME=/data
RUN mkdir -p /data/.fastclaw /data/.fastclaw/skills
VOLUME /data/.fastclaw

COPY skills/ /data/.fastclaw/skills/

EXPOSE 18953
ENTRYPOINT ["fastclaw"]
CMD ["gateway"]
