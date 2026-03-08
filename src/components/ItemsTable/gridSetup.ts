import { AllEnterpriseModule, LicenseManager, ModuleRegistry } from 'ag-grid-enterprise';

ModuleRegistry.registerModules([AllEnterpriseModule]);

const agGridLicenseKey = (import.meta.env.VITE_AG_GRID_LICENSE_KEY as string | undefined)?.trim();
const isTestRuntime = import.meta.env.MODE === 'test';

if (agGridLicenseKey) {
  LicenseManager.setLicenseKey(agGridLicenseKey);
} else if (!isTestRuntime) {
  console.warn('AG Grid Enterprise license key missing. Set VITE_AG_GRID_LICENSE_KEY to remove trial watermarks.');
}
