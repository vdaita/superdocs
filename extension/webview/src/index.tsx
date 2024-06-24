import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import { MantineProvider } from '@mantine/core';
import { Notifications } from '@mantine/notifications';

import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import reportWebVitals from './reportWebVitals';

import { PostHogProvider } from 'posthog-js/react';

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

const posthogOptions = {
  api_host: process.env.REACT_APP_PUBLIC_POSTHOG_HOST
}

root.render(
  <React.StrictMode>
    <PostHogProvider
      apiKey={process.env.REACT_APP_PUBLIC_POSTHOG_KEY}
      options={posthogOptions}
    >
      <MantineProvider defaultColorScheme="dark">
        <Notifications/>
        <App />
      </MantineProvider>
    </PostHogProvider>
  // </React.StrictMode>
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
