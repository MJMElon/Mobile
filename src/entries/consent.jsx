import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import ConsentPage from '../pages/Consent.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ConsentPage />
  </React.StrictMode>,
);
