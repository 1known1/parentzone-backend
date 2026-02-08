require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
const allowedOrigins = [
  'https://parentzone.onrender.com',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('⚠️ Blocked request from origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.use(express.json());

// Initialize Firebase Admin
let serviceAccount;

if (process.env.FIREBASE_SERVICE_ACCOUNT_BASE64) {
  // Production: Load from base64 environment variable (for Render/Railway)
  try {
    const base64Creds = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
    const jsonString = Buffer.from(base64Creds, 'base64').toString('utf-8');
    serviceAccount = JSON.parse(jsonString);
    console.log('✅ Firebase credentials loaded from environment variable');
  } catch (error) {
    console.error('❌ Failed to parse Firebase credentials from environment variable:', error);
    process.exit(1);
  }
} else {
  // Development: Load from local JSON file
  try {
    serviceAccount = require('./parentzone54-firebase-adminsdk-fbsvc-57062aeee3.json');
    console.log('✅ Firebase credentials loaded from local file (development mode)');
  } catch (error) {
    console.error('❌ Failed to load Firebase credentials from local file:', error);
    console.error('💡 For production, set FIREBASE_SERVICE_ACCOUNT_BASE64 environment variable');
    process.exit(1);
  }
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

console.log('✅ Firebase Admin initialized for project:', serviceAccount.project_id);

// In-memory storage (synced with Firestore)
const devices = new Map();
const families = new Map();

// Firestore reference
const db = admin.firestore();

// Load devices and families from Firestore on startup
const loadDevicesFromFirestore = async () => {
  try {
    console.log('📥 Loading devices from Firestore...');

    const devicesSnapshot = await db.collection('deviceRegistrations').get();
    devicesSnapshot.forEach(doc => {
      const data = doc.data();
      devices.set(doc.id, {
        fcmToken: data.fcmToken,
        deviceType: data.deviceType,
        familyId: data.familyId,
        linkedTo: data.linkedTo,
        registeredAt: data.registeredAt?.toDate?.()?.toISOString() || new Date().toISOString(),
      });
    });
    console.log(`✅ Loaded ${devices.size} devices`);

    const familiesSnapshot = await db.collection('families').get();
    familiesSnapshot.forEach(doc => {
      const data = doc.data();
      families.set(doc.id, {
        parentId: data.parentId,
        childIds: data.childIds || [],
      });
    });
    console.log(`✅ Loaded ${families.size} families`);
  } catch (error) {
    console.error('❌ Error loading data from Firestore:', error);
  }
};

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'ParentZone Backend API',
    status: 'running',
    endpoints: {
      health: '/health',
      testConnection: '/api/test/connection',
      registerDevice: 'POST /api/devices/register',
      syncDevice: 'POST /api/device/sync'
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Test endpoint to verify child device can reach the server
app.get('/api/test/connection', (req, res) => {
  console.log('🔗 Connection test from client');
  res.json({ 
    status: 'connected', 
    message: 'Child device can reach the server',
    timestamp: new Date().toISOString() 
  });
});

// Test endpoint for FirebaseSyncService initialization
app.post('/api/test/sync-init', (req, res) => {
  const { deviceId } = req.body;
  console.log(`🔄 FirebaseSyncService initialization test for: ${deviceId}`);
  res.json({ 
    status: 'initialized', 
    message: 'Sync service test successful',
    deviceId,
    timestamp: new Date().toISOString() 
  });
});

// Register device with FCM token
app.post('/api/devices/register', async (req, res) => {
  try {
    const { userId, fcmToken, deviceType, familyId } = req.body;

    if (!userId || !fcmToken || !deviceType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingDoc = await db.collection('deviceRegistrations').doc(userId).get();
    const existingData = existingDoc.exists ? existingDoc.data() : {};

    const updateData = {
      fcmToken,
      deviceType,
      familyId: familyId || existingData.familyId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    if (existingData.linkedTo) {
      updateData.linkedTo = existingData.linkedTo;
    }

    if (!existingDoc.exists) {
      updateData.registeredAt = admin.firestore.FieldValue.serverTimestamp();
    }

    await db.collection('deviceRegistrations').doc(userId).set(updateData, { merge: true });

    const cachedDevice = devices.get(userId) || {};
    devices.set(userId, {
      fcmToken,
      deviceType,
      familyId: familyId || existingData.familyId || cachedDevice.familyId,
      linkedTo: existingData.linkedTo || cachedDevice.linkedTo,
      registeredAt: cachedDevice.registeredAt || new Date().toISOString(),
    });

    console.log(`📱 Device registered/updated: ${userId} (${deviceType}) - FCM token updated`);

    if (deviceType === 'child') {
      console.log(`🔄 Child device registered - data collection should start automatically on client side`);
      console.log(`📡 Client should connect to: ${req.protocol}://${req.get('host')}/api/device/sync`);
    }

    res.json({
      success: true,
      message: 'Device registered successfully',
      userId,
      shouldStartDataCollection: deviceType === 'child',
    });
  } catch (error) {
    console.error('Error registering device:', error);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Sync child device data to Firebase
app.post('/api/device/sync', async (req, res) => {
  try {
    const { deviceId, data } = req.body;

    if (!deviceId || !data) {
      console.log('❌ Sync request missing data:', { deviceId: !!deviceId, data: !!data });
      return res.status(400).json({ error: 'Missing deviceId or data' });
    }

    console.log(`📤 Device data sync request received from: ${deviceId}`);
    console.log('📊 Received data:', {
      hasLocation: !!data.location,
      location: data.location,
      messageLogsCount: data.messageLogs?.length || 0,
      messageLogs: data.messageLogs?.slice(0, 2),
      callLogsCount: data.callLogs?.length || 0,
      appsCount: data.apps?.length || 0,
    });

    await db.collection('devices').doc(deviceId).set({
      ...data,
      lastSynced: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`✅ Data stored in Firestore for: ${deviceId}`);

    res.json({
      success: true,
      message: 'Device data synced successfully',
      deviceId,
      stored: {
        location: !!data.location,
        messageLogs: data.messageLogs?.length || 0,
        callLogs: data.callLogs?.length || 0,
      }
    });
  } catch (error) {
    console.error('Error syncing device data:', error);
    res.status(500).json({
      error: 'Failed to sync device data',
      details: error.message
    });
  }
});

// Load devices and families from Firestore on startup
loadDevicesFromFirestore();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 ParentZone backend server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});