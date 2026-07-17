import ReactDOM from 'react-dom/client';
import './App.css';
import AppShell from './components/AppShell';
import { AppProvider } from './context/AppContext';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <AppProvider>
    <AppShell />
  </AppProvider>
);
