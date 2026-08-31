import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import DoSigningPage from '../pages/DoSigning.jsx';
import { registerSW } from '../lib/registerSW.js';

registerSW();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <DoSigningPage />
  </React.StrictMode>,
);
