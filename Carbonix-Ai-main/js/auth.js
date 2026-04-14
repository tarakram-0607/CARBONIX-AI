import { auth, db } from "./firebase.js";
import { 
    signInWithEmailAndPassword, 
    createUserWithEmailAndPassword, 
    signInWithPopup, 
    GoogleAuthProvider,
    onAuthStateChanged,
    signOut
} from "https://www.gstatic.com/firebasejs/10.9.0/firebase-auth.js";
import { doc, setDoc, getDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.9.0/firebase-firestore.js";

document.addEventListener('DOMContentLoaded', () => {
    // Robust page detection — works with or without .html in URL
    const path = window.location.pathname;
    const isLoginPage = path.includes('login') || path === '/' || path.endsWith('/login.html');
    const isDashboardPage = path.includes('dashboard');
    
    // Elements
    const loginForm = document.getElementById('login-form');
    const nameGroup = document.getElementById('name-group');
    const fullnameInput = document.getElementById('fullname');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const googleLoginBtn = document.getElementById('google-login');
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const loginBtn = document.getElementById('login-btn');
    const signupBtn = document.getElementById('signup-btn');
    const authError = document.getElementById('auth-error');
    const logoutBtn = document.getElementById('logout-btn');

    let isSignUpMode = false;

    // Monitor Auth State
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            // User is signed in.
            if (isLoginPage) {
                window.location.href = 'dashboard.html';
            } else {
                // Update UI on dashboard
                const nameDisplay = document.getElementById('sidebar-user-name');
                const emailDisplay = document.getElementById('sidebar-user-email');
                const avatarIcon = document.getElementById('sidebar-avatar-initial');
                
                const userName = user.displayName || user.email.split('@')[0];
                
                if (nameDisplay) {
                    nameDisplay.textContent = userName;
                }
                if (emailDisplay) {
                    emailDisplay.textContent = user.email;
                    emailDisplay.title = user.email; // For hover on truncated text
                }
                if (avatarIcon) {
                    avatarIcon.textContent = userName.charAt(0).toUpperCase();
                }
            }
        } else {
            // No user is signed in.
            if (!isLoginPage) {
                window.location.href = 'login.html';
            }
        }
    });

    const showError = (message) => {
        if (!authError) return;
        authError.textContent = message;
        authError.classList.remove('hidden');
    };

    const hideError = () => {
        if (!authError) return;
        authError.classList.add('hidden');
    };

    // Save user to Firestore function
    const saveUserToFirestore = async (user) => {
        const userRef = doc(db, 'users', user.uid);
        const docSnap = await getDoc(userRef);
        
        // Only save if it's a new user (doesn't exist in db)
        if (!docSnap.exists()) {
            try {
                await setDoc(userRef, {
                    userID: user.uid,
                    name: user.displayName || user.email.split('@')[0],
                    email: user.email,
                    createdAt: serverTimestamp()
                });

                // Initialize userProfile doc for intelligence engine
                await setDoc(doc(db, 'userProfile', user.uid), {
                    uid: user.uid,
                    avgByCategory: { electricity: 0, travel: 0, food: 0 },
                    avgTotal: 0,
                    trend: 'stable',
                    streaks: { electricity: 0, travel: 0, food: 0 },
                    highestCategory: null,
                    recordCount: 0,
                    behaviorFlags: {},
                    joinedAt: serverTimestamp(),
                    lastUpdated: serverTimestamp()
                });
            } catch (error) {
                console.error("Error saving user data:", error);
            }
        }
    };

    // Toggle Login/Signup mode via Tabs
    const setAuthMode = (isSignUp) => {
        isSignUpMode = isSignUp;
        hideError();
        
        if (isSignUp) {
            tabSignup.classList.add('active');
            tabLogin.classList.remove('active');
            loginBtn.classList.add('hidden');
            signupBtn.classList.remove('hidden');
            nameGroup.classList.remove('hidden');
            if (fullnameInput) fullnameInput.required = true;
        } else {
            tabLogin.classList.add('active');
            tabSignup.classList.remove('active');
            loginBtn.classList.remove('hidden');
            signupBtn.classList.add('hidden');
            nameGroup.classList.add('hidden');
            if (fullnameInput) fullnameInput.required = false;
        }
    };

    if (tabLogin && tabSignup) {
        tabLogin.addEventListener('click', () => setAuthMode(false));
        tabSignup.addEventListener('click', () => setAuthMode(true));
    }

    // Handle Email/Password form submit
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            hideError();
            
            const btnStates = (loading) => {
                const btn = isSignUpMode ? signupBtn : loginBtn;
                btn.disabled = loading;
                btn.innerHTML = loading ? '<i class="fas fa-spinner fa-spin"></i> Processing...' : 
                    (isSignUpMode ? '<span>Sign Up</span> <i class="fas fa-user-plus"></i>' : '<span>Login</span> <i class="fas fa-arrow-right"></i>');
            };

            btnStates(true);
            
            try {
                if (isSignUpMode) {
                    const userCredential = await createUserWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
                    // Add the name to the user object before saving
                    const user = userCredential.user;
                    if (fullnameInput && fullnameInput.value) {
                         user.displayName = fullnameInput.value;
                    }
                    await saveUserToFirestore(user);
                } else {
                    await signInWithEmailAndPassword(auth, emailInput.value, passwordInput.value);
                }
            } catch (error) {
                console.error("Auth error:", error);
                let msg = 'Authentication failed. Please check your credentials.';
                if (error.code === 'auth/email-already-in-use') msg = 'Email is already in use.';
                if (error.code === 'auth/weak-password') msg = 'Password should be at least 6 characters.';
                if (error.code === 'auth/user-not-found' || error.code === 'auth/wrong-password' || error.code === 'auth/invalid-credential') msg = 'Invalid email or password.';
                
                // Show the raw error message to help debug hosting issues
                showError(`${msg} (${error.message})`);
            } finally {
                btnStates(false);
            }
        });
    }

    // Handle Google Login
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', async () => {
            hideError();
            googleLoginBtn.disabled = true;
            googleLoginBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
            try {
                const provider = new GoogleAuthProvider();
                provider.setCustomParameters({ prompt: 'select_account' });
                const userCredential = await signInWithPopup(auth, provider);
                // Save profile (fire-and-forget — don't block redirect)
                saveUserToFirestore(userCredential.user).catch(e => console.warn('Profile save:', e));
                // Explicit redirect — don't rely solely on onAuthStateChanged
                window.location.href = 'dashboard.html';
            } catch (error) {
                console.error(error);
                if (error.code !== 'auth/popup-closed-by-user' && error.code !== 'auth/cancelled-popup-request') {
                    showError('Google sign in failed. ' + (error.message || error.code));
                }
            } finally {
                googleLoginBtn.disabled = false;
                googleLoginBtn.innerHTML = '<img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" class="google-logo"> Sign in with Google';
            }
        });
    }

    // Handle Logout
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            signOut(auth).catch(error => {
                console.error('Logout error:', error);
            });
        });
        
        // Handle Mobile Sidebar Logout
        const mobLogoutBtn = document.querySelector('.sidebar .logout');
        if (mobLogoutBtn && mobLogoutBtn !== logoutBtn) {
            mobLogoutBtn.addEventListener('click', () => {
                signOut(auth).catch(error => console.error('Logout error:', error));
            });
        }
    }
});
