# Contributing to Ascent

Thank you for your interest in contributing to **Ascent**! Whether you are an open-source engineer looking to tackle low-level Android sensor daemons or a machine learning researcher interested in multi-sensor indoor localization, your contributions are welcome.

---

## 1. Project Context & Contribution Tracks

Ascent is currently advancing through an independent roadmap. Because the primary maintainer’s active development bandwidth is dedicated to **Phase 2 (Machine Learning Classification & generalized training pipelines)**, we are **actively inviting the open-source community to step up and maintain Phase 1—the Ascent mobile application itself and its native data collection engine**.

Our shared goal is to evolve Phase 1 from a raw, experimental internal prototype into a **smooth, robust, and generalized data-collection tool** that researchers, students, and developers across the world can easily deploy on any Android device to build their own spatial datasets.

Contributions primarily fall into two overarching tracks:

### Track A: Community Maintenance of Phase 1 (Ascent App & Collection Engine)
* **Background Execution Reliability:** Overhaul the native Android foreground service and execution daemon (`modules/recording-keepalive/android/.../RecordingImuService.kt`) to ensure stable, non-terminating sensor collection without excessive wake-lock battery drain.
* **Device Presence & State-Vector Module:** Debug and repair the broken lifecycle listeners in `DevicePresence.kt` to ensure reliable tracking of application state (`appState`: foreground vs. background) and display status (`lockScreen` and `screenOn`).
* **Hardware Generalization & Vendor Compatibility:** Expand sensor abstraction across diverse Android OEMs, mitigate vendor-specific power-saving interventions, and optimize high-rate IMU ring-buffers.
* **Streamlining UX & Session Workflow:** Improve the mobile user experience for defining custom floor layouts, managing recording sessions, and exporting standardized datasets smoothly.

### Track B: Phase 2 Machine Learning & Tooling
* **Feature Engineering:** Extracting temporal, statistical, and frequency-domain features from synchronized 6-DoF inertial dynamics, atmospheric pressure delta curves, and RF RSSI distributions.
* **Model Architectures:** Implementing, training, and benchmarking classification models (e.g., ensemble trees, 1D-CNNs, Recurrent/Transformer models) to predict discrete floor levels (`Floor 1` vs. `Floor 2`).
* **"Bring-Your-Own-Dataset" (BYOD) Framework:** Developing modular data cleaning scripts, validation harnesses, and training CLIs that allow anyone to train custom classifiers on datasets collected via Phase 1.
* **Exploratory Notebooks & Visualizations:** Building analytical visualizations for evaluating RF propagation gradients, stairwell kinetic transitions, and sensor calibration.

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
