FROM otel/opentelemetry-collector-contrib:0.135.0

COPY vault-health-probe/config.yaml /etc/otelcol-contrib/config.yaml

CMD ["--config=/etc/otelcol-contrib/config.yaml"]
