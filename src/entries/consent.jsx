import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import ConsentPage from '../pages/Consent.jsx';
import { registerSW } from '../lib/registerSW.js';

registerSW();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConsentPage />
  </React.StrictMode>,
);
