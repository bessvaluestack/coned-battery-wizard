# Running the wizard with saved projects on one machine

Three containers, started together by Docker Compose:

| Service | What it is | Reachable |
|---|---|---|
| `web` | Caddy: HTTPS (Let's Encrypt), the team login, the wizard's client build, `/api/*` passed to `api` | ports 80 and 443 |
| `api` | Node 22 + Fastify: saved projects with revisions (`server/`) | only from `web` |
| `db` | Postgres 17: the projects (Docker volume `pgdata`) | only from `api` |

Tested on Ubuntu with Docker Engine and the Compose plugin. Commands below
run on the machine, as a user with `sudo`.

## 0. Before you start

- **DNS:** an `A` record for the name you will use (say `wizard.example.com`)
  pointing at the machine's fixed IP, plus an `AAAA` record if it has IPv6.
  Check from anywhere: `dig +short wizard.example.com` prints the IP.
- **Ports 80 and 443** reachable from the internet (forward them on the router
  if the machine is behind one). Let's Encrypt needs them to issue the
  certificate.

## 1. Prepare the machine

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y git unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades      # answer Yes: security updates install themselves
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw enable
```

Use SSH keys only: once a key login works, set `PasswordAuthentication no`
in `/etc/ssh/sshd_config` and `sudo systemctl reload ssh`.

## 2. Install Docker

From Docker's own repository:

```sh
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | sudo tee /etc/apt/sources.list.d/docker.list
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER        # then log out and back in
docker run --rm hello-world          # prints "Hello from Docker!"
```

If `apt update` complains about the Docker line on a brand-new Ubuntu
release, Docker has not published it yet: put the latest LTS name (`noble`)
in `/etc/apt/sources.list.d/docker.list` instead.

## 3. Get the code

```sh
sudo mkdir -p /opt/coned-battery-wizard && sudo chown $USER: /opt/coned-battery-wizard
git clone https://github.com/bessvaluestack/coned-battery-wizard.git /opt/coned-battery-wizard
cd /opt/coned-battery-wizard/deploy
```

## 4. Configure

```sh
cp .env.example .env
sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(openssl rand -hex 24)/" .env
nano .env                  # set DOMAIN and ACME_EMAIL
chmod 600 .env
./add-user.sh nick         # asks for a password (12+ characters); repeat for each teammate
```

`.env` and `users.caddy` hold secrets and stay out of git.

## 5. Start

```sh
docker compose up -d --build       # the first build takes a few minutes
docker compose ps                  # db healthy, api and web up
docker compose logs -f web         # wait for "certificate obtained successfully", then Ctrl-C
```

## 6. Check

- `https://<DOMAIN>` in a browser asks for the login, then shows the wizard.
- `curl -u nick https://<DOMAIN>/api/health` answers `{"ok":true,"db":"up",...}`.
- `curl -u nick https://<DOMAIN>/api/projects` answers `{"projects":[]}`.

## Day to day

| Task | Command (in `/opt/coned-battery-wizard/deploy`) |
|---|---|
| Update to the latest code | `git -C .. pull && docker compose up -d --build` |
| Logs | `docker compose logs -f api` (or `web`, `db`) |
| Add or change a login | `./add-user.sh <name>` |
| Back up now | `./backup.sh` (gzipped SQL in `deploy/backups/`, 30 days kept) |
| Back up daily | `crontab -e`, add `15 3 * * * /opt/coned-battery-wizard/deploy/backup.sh >> $HOME/wizard-backup.log 2>&1` |
| Database shell | `docker compose exec db psql -U wizard -d wizard` |
| Stop | `docker compose down` (the data stays; `down -v` would delete it) |

Copy the backups off the machine as well (another disk, or `rclone` to
cloud storage): a single machine is the weak point of this setup.

Docker publishes ports past `ufw`, so only `web` publishes any; `api` and
`db` sit on internal networks.

## Later: the cloud

The same images run anywhere that runs containers (Fly.io, Render, AWS,
Azure): point `DATABASE_URL` at a managed Postgres and restore a backup into
it.
