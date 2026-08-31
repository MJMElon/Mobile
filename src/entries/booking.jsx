import React from 'react';
import { createRoot } from 'react-dom/client';
import '../styles/index.css';
import BookingPage from '../pages/Booking.jsx';
import { registerSW } from '../lib/registerSW.js';

registerSW();

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BookingPage />
  </React.StrictMode>,
);
