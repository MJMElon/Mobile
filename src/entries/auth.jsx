import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import AuthPage from '../pages/Auth.jsx';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AuthPage />
  </React.StrictMode>,
);
