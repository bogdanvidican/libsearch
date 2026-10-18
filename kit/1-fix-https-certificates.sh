#!/usr/bin/env bash
# One-time fix for Ubuntu 16.04: refresh HTTPS certificates so curl can open modern sites.
# Run:  sudo bash 1-fix-https-certificates.sh
if [ "$(id -u)" -ne 0 ]; then echo "Please run with sudo:  sudo bash $0"; exit 1; fi
set -x
apt-get update
apt-get install -y --only-upgrade ca-certificates curl openssl || apt-get install -y ca-certificates curl
# The expired "DST Root CA X3" certificate breaks Let's Encrypt sites on old OpenSSL. Disable it.
if grep -q '^mozilla/DST_Root_CA_X3.crt' /etc/ca-certificates.conf; then
  sed -i 's|^mozilla/DST_Root_CA_X3.crt|!mozilla/DST_Root_CA_X3.crt|' /etc/ca-certificates.conf
fi
update-ca-certificates --fresh
set +x
echo; echo "Done. Next step:  bash 2-download-pdf-books.sh"
