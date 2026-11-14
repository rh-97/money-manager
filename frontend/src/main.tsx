import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { cryptoReady } from '@mm/shared';
import { App } from './App.tsx';
import './styles.css';

// Apply the last used look before anything renders, so the login screen matches.
try {
  const look = JSON.parse(localStorage.getItem('mm-look') ?? '{}') as { style?: string; theme?: string };
  document.documentElement.dataset.style = look.style ?? 'colour';
  if (look.theme && look.theme !== 'system') document.documentElement.dataset.theme = look.theme;
} catch {
  document.documentElement.dataset.style = 'colour';
}

await cryptoReady();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
