import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import IndexPage from '../pages/Index.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <IndexPage />
  </React.StrictMode>,
);
