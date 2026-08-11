/**
 * FIREBASE SETUP — Step-by-step
 * =============================
 * 1. Go to https://console.firebase.google.com/
 * 2. Click "Add project" → give it a name → Continue
 * 3. In the project, click the </> (Web) icon to add a web app
 * 4. Copy the firebaseConfig values shown and paste them below
 *
 * 5. Enable Authentication:
 *    Firebase Console → Authentication → Sign-in method
 *    → Enable "Google" and/or "Email/Password"
 *
 * 6. Enable Firestore Database:
 *    Firebase Console → Firestore Database → Create database
 *    → Start in production mode → choose a region → Done
 *
 * 7. Set Firestore Security Rules (Rules tab):
 *
 *    rules_version = '2';
 *    service cloud.firestore {
 *      match /databases/{database}/documents {
 *
 *        // Each user's profile (stores their household list)
 *        match /users/{userId} {
 *          allow read, write: if request.auth != null
 *                             && request.auth.uid == userId;
 *        }
 *
 *        // Household budget data — any member can read/write
 *        match /households/{householdId} {
 *          allow read, update: if request.auth != null
 *                              && request.auth.uid in resource.data.members;
 *          allow create: if request.auth != null;
 *
 *          match /months/{month} {
 *            allow read, write: if request.auth != null
 *              && request.auth.uid in
 *                 get(/databases/$(database)/documents/households/$(householdId))
 *                   .data.members;
 *          }
 *        }
 *      }
 *    }
 *
 * 8. If deploying to GitHub Pages, add your GitHub Pages URL to:
 *    Firebase Console → Authentication → Settings → Authorized domains
 *
 * ─────────────────────────────────────────────────────────────
 * Leave apiKey as "YOUR_API_KEY" to disable Firebase and use
 * browser localStorage only (single-device, no login required).
 * ─────────────────────────────────────────────────────────────
 */

window.firebaseConfig = {
    apiKey: "AIzaSyB5lp4Oj9MVfOnQB8ZAm6ZkAIYBR_Mu4jo",
    authDomain: "housebudget-4eec6.firebaseapp.com",
    projectId: "housebudget-4eec6",
    storageBucket: "housebudget-4eec6.firebasestorage.app",
    messagingSenderId: "199569896108",
    appId: "1:199569896108:web:876401760df2c782a92509",
    measurementId: "G-EN22BW76NY"
};
