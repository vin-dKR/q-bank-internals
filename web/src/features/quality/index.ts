// Public surface of the quality feature (§4). The app shell imports from here only.
export { ModeSwitch, QualityDashboard, type QualityMode } from './components/quality-dashboard.js';
export { RunScanButton } from './components/run-scan-button.js';
export { useAiProposals, useQualitySummary } from './hooks/use-quality.js';
