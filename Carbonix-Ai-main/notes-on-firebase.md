The credentials you provided are for a backend Service Account SDK (usually used in Node.js, Python, etc. backends). 
Our project is a pure frontend Web Application.

To connect the frontend correctly, we need the Firebase Web App configuration block, which uses an `apiKey` and `appId`.

**Where to find it:**
1. Go to your [Firebase Console](https://console.firebase.google.com/).
2. Open your project `carbon-footprints-9f79f`.
3. Click the gear icon (⚙️) next to "Project Overview", click **Project settings**.
4. Scroll down to "Your apps".
5. If you haven't added a web app yet, click the `</>` (Web) icon to add one.
6. Copy the `firebaseConfig` object and paste it here, and I will update your code!
