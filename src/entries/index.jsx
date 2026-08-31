import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import IndexPage from '../pages/Index.jsx';
import { registerSW } from '../lib/registerSW.js';

registerSW();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IndexPage />
  </React.StrictMode>,
);
