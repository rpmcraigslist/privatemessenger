import {
  isAdminBackendDeployed,
  isBackendConfigured,
} from './lib/amplify';
import SetupNotice from './components/SetupNotice';
import BackendUpgradeNotice from './components/BackendUpgradeNotice';
import AuthGate from './components/AuthGate';
import Messenger from './components/Messenger';

export default function App() {
  if (!isBackendConfigured) {
    return <SetupNotice />;
  }

  if (!isAdminBackendDeployed) {
    return <BackendUpgradeNotice />;
  }

  return (
    <AuthGate>
      {(onSignOut) => <Messenger onSignOut={onSignOut} />}
    </AuthGate>
  );
}
