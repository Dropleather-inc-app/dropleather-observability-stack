FROM otel/opentelemetry-collector-contrib:0.135.0

COPY vault-health-probe/config.yaml /etc/otelcol-contrib/config.yaml
COPY vault-health-probe/vault-ca.pem /etc/otelcol-contrib/vault-ca.pem

CMD ["--config=/etc/otelcol-contrib/config.yaml"]
