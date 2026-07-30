FROM rust:1-slim AS build
WORKDIR /build
# rusqlite's "bundled" feature compiles SQLite from source, so cc is required.
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
# Cargo.lock is copied and --locked enforced so your friend's build resolves the
# same dependency versions that were tested here.
COPY Cargo.toml Cargo.lock ./
COPY src ./src
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --system --uid 10001 albas \
    && mkdir -p /data && chown albas /data
COPY --from=build /build/target/release/albas-sync /usr/local/bin/albas-sync
USER albas
VOLUME ["/data"]
EXPOSE 8787
ENV ALBAS_SYNC_DB=/data/albas-sync.db \
    ALBAS_SYNC_ADDR=0.0.0.0:8787
CMD ["albas-sync"]
