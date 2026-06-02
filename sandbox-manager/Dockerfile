FROM golang:1.26-bookworm AS builder
WORKDIR /app
COPY go.* ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o sandbox-manager .

FROM gcr.io/distroless/static-debian12
COPY --from=builder /app/sandbox-manager /
EXPOSE 8081
ENTRYPOINT ["/sandbox-manager"]
