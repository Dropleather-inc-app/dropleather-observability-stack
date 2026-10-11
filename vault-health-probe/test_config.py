"""Vault probe TLS and metrics scrape contract."""

from pathlib import Path
import unittest


HERE = Path(__file__).parent


class VaultProbeConfigTest(unittest.TestCase):
    def test_private_https_health_and_metrics_have_ca_trust(self):
        config = (HERE / "config.yaml").read_text()
        self.assertIn("prometheus/vault:", config)
        self.assertIn("/v1/sys/metrics", config)
        self.assertIn("ca_file: /etc/otelcol-contrib/vault-ca.pem", config)
        self.assertNotIn("insecure_skip_verify", config)
        self.assertNotIn("noTLSVerify", config)

    def test_image_carries_public_ca_only(self):
        dockerfile = (HERE / "Dockerfile").read_text()
        self.assertIn("vault-ca.pem /etc/otelcol-contrib/vault-ca.pem", dockerfile)
        self.assertTrue((HERE / "vault-ca.pem").is_file())
        self.assertFalse((HERE / "vault-key.pem").exists())


if __name__ == "__main__":
    unittest.main()
