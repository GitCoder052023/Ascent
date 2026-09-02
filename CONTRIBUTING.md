# Contributing to Ascent

Thank you for your interest in contributing to **Ascent**! Whether you are an open-source engineer looking to tackle low-level Android sensor daemons or a machine learning researcher interested in multi-sensor indoor localization, your contributions are welcome.

---

## 1. Project Context & Focus Areas

Ascent is currently operating under an independent roadmap transitioning into **Phase 2 (Machine Learning Classification)** while maintaining an open call for community contributions to fix **Ascent's native data collection core**.

Contributions generally fall into one of two major tracks:

### Track A: Ascent Native Core Stabilization (High Priority)
Ascent's collection core is built as a custom Expo native module with an Android foreground service. We are actively seeking native Android/Kotlin developers to resolve known core issues:
* **Background Execution Stability:** Overhauling the background execution daemon (`modules/recording-keepalive/android/.../RecordingImuService.kt`) to ensure stable, continuous sensor sampling without excessive battery drain or OS task termination.
* **Device Presence & Screen State:** Debugging and fixing the malfunctioning broadcast receivers in `DevicePresence.kt` responsible for tracking `appState` (foreground vs. background) and `lockScreen`/`screenOn` states.
* **Sensor Buffer Performance:** Optimizing high-frequency IMU buffering, atomic SQLite commits, and memory footprint during extended collection sessions.

### Track B: Phase 2 Machine Learning & Tooling
* **Feature Engineering:** Extracting temporal and spectral features from synchronized 6-DoF inertial dynamics, atmospheric pressure delta curves, and RF RSSI distributions.
* **Model Architectures:** Implementing, training, and benchmarking classification algorithms (e.g., ensemble trees, 1D-CNNs, Recurrent/Transformer models) to predict discrete floor levels (`Floor 1` vs. `Floor 2`).
* **"Bring-Your-Own-Dataset" Pipelines:** Developing modular scripts and tooling that allow anyone to ingest custom CSV exports and train bespoke classifiers for their own physical spaces.
* **Data Visualization & Analysis:** Building analysis scripts and exploratory notebooks for evaluating multi-floor RF propagation and stairwell transition dynamics.

---

## 2. Contribution Workflow

### 2.1 Getting Started
1. **Fork the Repository:** Create a personal fork of the repository on GitHub.
2. **Clone Locally:** Clone your fork to your development machine:
   ```bash
   git clone https://github.com/<your-username>/Ascent.git
   cd Ascent
   ```
3. **Install Dependencies:**
   ```bash
   npm install
   ```

### 2.2 Branch Naming Conventions
Create a dedicated branch with a descriptive prefix:
* `fix/` — for bug fixes (e.g., `fix/android-presence-receiver`, `fix/background-wakelock-leak`)
* `feat/` — for new features (e.g., `feat/dataset-export-cli`, `feat/byod-training-script`)
* `ml/` — for machine learning pipelines and models (e.g., `ml/random-forest-baseline`, `ml/feature-extraction`)
* `docs/` — for documentation updates (e.g., `docs/add-dataset-schema-guide`)

### 2.3 Submitting a Pull Request
1. **Keep Changes Scoped:** Keep pull requests focused on a single logical change or bugfix.
2. **Document Your Changes:** Provide a clear description in your PR explaining:
   - What problem was solved or what feature was introduced.
   - Any manual testing performed (including hardware/device models tested if touching native Android code).
3. **Maintain Code Style:**
   - For TypeScript/JavaScript: ensure code passes linting (`npm run lint`).
   - For Kotlin/Android: adhere to standard Android Kotlin style conventions.
   - For Python (Phase 2): adhere to PEP 8.
4. **Submit for Review:** Open a pull request against the `main` branch.

---

## 3. Telemetry Privacy & Data Integrity

When contributing datasets, test fixtures, or analysis notebooks:
* **Never commit unhashed, identifiable Wi-Fi BSSIDs or SSIDs** from private residential spaces or non-public facilities.
* Review our [Security & Privacy Policy](SECURITY.md) for data anonymization best practices before publishing test datasets or sample captures.

---

## 4. Code of Conduct

All contributors and participants are expected to uphold our standards of respectful, collaborative behavior as outlined in the [Code of Conduct](CODE_OF_CONDUCT.md).
