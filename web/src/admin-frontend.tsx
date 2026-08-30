import React from 'react';
import { createRoot } from 'react-dom/client';
import { AdminConsole } from './AdminConsole';
import './admin.css';

const root = createRoot(document.body);
root.render(<AdminConsole />);
