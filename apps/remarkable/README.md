# Just Maple for reMarkable

Native reMarkable tablet application for Just Maple, providing Notes, Whiteboard, Messages, and Lego collection features.

## Features

- **Notes**: Create and edit text notes with Y.js CRDT sync
- **Whiteboard**: Stylus drawing with pressure sensitivity, optimized for e-ink
- **Messages**: Real-time chat per notebook with offline queue
- **Lego Catalog**: Browse and manage your Lego collection

## Architecture

```
src/
├── main.rs          # App entry point and state management
├── auth/            # Stored session management; passkey login unavailable
├── storage/         # Local sled database
├── sync/            # HTTP API client, WebSocket, offline queue
├── eink/            # E-ink display refresh management
├── input/           # Stylus and touch handling
└── ui/              # egui-based user interface
    ├── screens/     # Main app screens
    ├── components/  # Reusable UI components
    └── widgets/     # Custom egui widgets
```

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [cross](https://github.com/cross-rs/cross): `cargo install cross`
- Docker (for cross-compilation)

## Building

```bash
# Build for reMarkable
./scripts/build.sh

# Or manually with cross:
cross build --release --target armv7-unknown-linux-gnueabihf
```

## Deployment

### Manual (via USB/SSH)

```bash
# Deploy to reMarkable (default IP: 10.11.99.1)
./scripts/deploy.sh

# Or specify IP:
./scripts/deploy.sh 192.168.1.100
```

### Toltec Package

```bash
# Create .ipk package for Toltec
./scripts/package-toltec.sh

# Install on reMarkable:
scp justmaple_*.ipk root@10.11.99.1:/tmp/
ssh root@10.11.99.1 'opkg install /tmp/justmaple_*.ipk'
```

## Configuration

Environment variables:

| Variable             | Default                             | Description        |
| -------------------- | ----------------------------------- | ------------------ |
| `MAPLE_API_URL`      | `https://api.justmaple.app`         | Backend API URL    |
| `MAPLE_WS_URL`       | `wss://api.justmaple.app/ws`        | WebSocket URL      |
| `MAPLE_STORAGE_PATH` | `/home/root/.local/share/justmaple` | Local storage path |
| `RUST_LOG`           | `info`                              | Log level          |

## E-ink Optimization

The app uses different refresh modes for optimal e-ink performance:

| Action     | Mode          | Latency |
| ---------- | ------------- | ------- |
| Drawing    | A2 (binary)   | ~50ms   |
| Scrolling  | Direct Update | ~80ms   |
| UI updates | Partial       | ~120ms  |
| Navigation | Full          | ~300ms  |

## Offline Support

All data is cached locally in a sled database. Changes made offline are queued and synced when connectivity is restored.

## Development & Testing

### Option 1: Desktop Mode (Recommended)

Run the app natively on your development machine. The UI renders using egui with mouse/keyboard input instead of stylus.

```bash
# Quick start - runs with local dev server
./scripts/run-desktop.sh

# Or manually:
cargo run --features desktop

# Build release for desktop
./scripts/build.sh --desktop
```

The app window simulates the reMarkable display (1404x1872 pixels). Use your mouse as a stylus for whiteboard testing.

**Environment for local dev:**

```bash
export MAPLE_API_URL=http://localhost:7071
export MAPLE_WS_URL=ws://localhost:7071/ws
export MAPLE_STORAGE_PATH=$HOME/.local/share/justmaple-dev
```

### Option 2: reMarkable Simulator (remarkable-sim)

The community [remarkable-sim](https://github.com/AuroransSolis/remarkable-sim) project provides a more accurate simulation:

```bash
# Install remarkable-sim
git clone https://github.com/AuroransSolis/remarkable-sim
cd remarkable-sim
cargo install --path .

# Build Just Maple for remarkable
./scripts/build.sh --remarkable

# Run in simulator
remarkable-sim ./target/armv7-unknown-linux-gnueabihf/release/justmaple-remarkable
```

### Option 3: QEMU ARM Emulation

For full ARM emulation (slower but most accurate):

```bash
# Install QEMU
brew install qemu  # macOS
# apt install qemu-user-static  # Linux

# Build for ARM
./scripts/build.sh --remarkable

# Run with QEMU
qemu-arm -L /usr/arm-linux-gnueabihf \
  ./target/armv7-unknown-linux-gnueabihf/release/justmaple-remarkable
```

Note: QEMU won't have e-ink display or stylus input, but can test core logic.

### Running Tests

```bash
# Run all tests
cargo test

# Run with logging
RUST_LOG=debug cargo test -- --nocapture
```

### Feature Flags

| Feature       | Description                                            |
| ------------- | ------------------------------------------------------ |
| `desktop`     | Desktop mode (default) - egui native                   |
| `remarkable`  | reMarkable device mode - includes libremarkable, evdev |
| `custom-font` | Use bundled Inter font                                 |

```bash
# Build for reMarkable device
cargo build --features remarkable --no-default-features

# Build for desktop with custom font
cargo build --features "desktop custom-font"
```

## License

MIT - See LICENSE file
