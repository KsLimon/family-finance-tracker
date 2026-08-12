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
 *        // Each user's profile
 *        match /users/{userId} {
 *          allow read, write: if request.auth != null
 *                             && request.auth.uid == userId;
 *        }
 *
 *        match /households/{householdId} {
 *          // Any signed-in user can read (required to find household by invite code)
 *          allow read: if request.auth != null;
 *          // Any signed-in user can create a new household
 *          allow create: if request.auth != null;
 *          // Existing members can update freely;
 *          // non-members may only add themselves (join via invite code)
 *          allow update: if request.auth != null
 *            && (request.auth.uid in resource.data.members
 *                || (request.auth.uid in request.resource.data.members
 *                    && request.resource.data.members.hasAll(resource.data.members)
 *                    && request.resource.data.members.size()
 *                       == resource.data.members.size() + 1));
 *          // Only the creator can delete a household
 *          allow delete: if request.auth != null
 *                        && request.auth.uid == resource.data.createdBy;
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
