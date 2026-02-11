require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
const allowedOrigins = [
  'https://parentzone.onrender.com',
  'https://parentzone-frontend.onrender.com',
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:8080'
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('⚠️ Blocked request from origin:', origin);
      callback(null, true); // Allow anyway for now to debug
    }
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));

// Additional CORS headers for preflight requests
app.options('*', cors());

app.use(express.json());

// Request logging middleware
app.use((req, res, next) => {
  const timestamp = new Date().toISOString();
  console.log(`\n📨 ${req.method} ${req.path} - ${timestamp}`);
  if (req.method === 'POST' && Object.keys(req.body).length > 0) {
    console.log(`   Body keys: ${Object.keys(req.body).join(', ')}`);
  }
  next();
});

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
  console.log(`\n🔗 CONNECTION TEST from ${req.ip} at ${new Date().toISOString()}`);
  res.json({ 
    status: 'connected', 
    message: 'Child device can reach the server',
    timestamp: new Date().toISOString() 
  });
});

// Test endpoint for FirebaseSyncService initialization
app.post('/api/test/sync-init', (req, res) => {
  const { deviceId } = req.body;
  console.log(`\n🔄 SYNC SERVICE INIT TEST`);
  console.log(`   Device ID: ${deviceId}`);
  console.log(`   Timestamp: ${new Date().toISOString()}`);
  res.json({ 
    status: 'initialized', 
    message: 'Sync service test successful',
    deviceId,
    timestamp: new Date().toISOString() 
  });
});

// Get device registration info (including linked child)
app.get('/api/devices/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📱 FETCHING DEVICE REGISTRATION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`User ID: ${userId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const deviceDoc = await db.collection('deviceRegistrations').doc(userId).get();

    if (!deviceDoc.exists) {
      console.log(`⚠️ Device registration not found for: ${userId}`);
      console.log(`${'='.repeat(60)}\n`);
      return res.json({
        success: true,
        device: null,
        message: 'Device not registered yet'
      });
    }

    const deviceData = deviceDoc.data();
    
    console.log(`✅ DEVICE REGISTRATION FOUND`);
    console.log(`   Device Type: ${deviceData.deviceType || 'N/A'}`);
    console.log(`   Family ID: ${deviceData.familyId || 'N/A'}`);
    console.log(`   Linked To: ${deviceData.linkedTo || 'N/A'}`);
    console.log(`   FCM Token: ${deviceData.fcmToken ? deviceData.fcmToken.substring(0, 20) + '...' : 'N/A'}`);
    console.log(`   Registered At: ${deviceData.registeredAt?.toDate?.()?.toISOString() || 'N/A'}`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      device: {
        userId: userId,
        deviceType: deviceData.deviceType,
        familyId: deviceData.familyId,
        linkedTo: deviceData.linkedTo,
        fcmToken: deviceData.fcmToken,
        registeredAt: deviceData.registeredAt?.toDate?.()?.toISOString() || null,
        updatedAt: deviceData.updatedAt?.toDate?.()?.toISOString() || null
      }
    });
  } catch (error) {
    console.error(`\n❌ ERROR FETCHING DEVICE REGISTRATION:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device registration',
      details: error.message
    });
  }
});

// Register device with FCM token
app.post('/api/devices/register', async (req, res) => {
  try {
    const { userId, fcmToken, deviceType, familyId } = req.body;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📱 DEVICE REGISTRATION REQUEST`);
    console.log(`${'='.repeat(60)}`);
    console.log(`User ID: ${userId}`);
    console.log(`Device Type: ${deviceType}`);
    console.log(`Family ID: ${familyId || 'Not provided'}`);
    console.log(`FCM Token: ${fcmToken ? fcmToken.substring(0, 20) + '...' : 'Missing'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!userId || !fcmToken || !deviceType) {
      console.log(`❌ Registration failed - Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingDoc = await db.collection('deviceRegistrations').doc(userId).get();
    const existingData = existingDoc.exists ? existingDoc.data() : {};

    const updateData = {
      fcmToken,
      deviceType,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    // Only add familyId if it's provided and not undefined
    if (familyId !== undefined && familyId !== null) {
      updateData.familyId = familyId;
    } else if (existingData.familyId) {
      updateData.familyId = existingData.familyId;
    }

    // Only add linkedTo if it exists
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
      familyId: updateData.familyId || cachedDevice.familyId,
      linkedTo: updateData.linkedTo || cachedDevice.linkedTo,
      registeredAt: cachedDevice.registeredAt || new Date().toISOString(),
    });

    console.log(`✅ Device registered successfully in Firestore`);

    if (deviceType === 'child') {
      console.log(`\n🎯 CHILD DEVICE DETECTED - DATA COLLECTION SHOULD START`);
      console.log(`📡 Sync endpoint: ${req.protocol}://${req.get('host')}/api/device/sync`);
      console.log(`⏰ Waiting for data collection to begin...`);
      console.log(`💡 Check client logs for FirebaseSyncService initialization`);
    }
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'Device registered successfully',
      userId,
      shouldStartDataCollection: deviceType === 'child',
    });
  } catch (error) {
    console.error('❌ Error registering device:', error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// Sync child device data to Firebase
app.post('/api/device/sync', async (req, res) => {
  try {
    const { deviceId, data } = req.body;

    console.log(`\n${'='.repeat(60)}`);
    console.log(`📤 DATA COLLECTION SYNC REQUEST`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId || 'MISSING'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!deviceId || !data) {
      console.log('❌ Sync request missing required fields');
      console.log(`   - Device ID: ${deviceId ? '✓' : '✗ MISSING'}`);
      console.log(`   - Data: ${data ? '✓' : '✗ MISSING'}`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing deviceId or data' });
    }

    console.log(`\n📊 DATA RECEIVED:`);
    console.log(`   📍 Location: ${data.location ? '✓ YES' : '✗ NO'}`);
    if (data.location) {
      console.log(`      - Lat: ${data.location.latitude}`);
      console.log(`      - Lng: ${data.location.longitude}`);
      console.log(`      - Accuracy: ${data.location.accuracy}m`);
    }
    console.log(`   💬 Message Logs: ${data.messageLogs?.length || 0} entries`);
    if (data.messageLogs?.length > 0) {
      console.log(`      - Sample: ${JSON.stringify(data.messageLogs[0])}`);
    }
    console.log(`   📞 Call Logs: ${data.callLogs?.length || 0} entries`);
    if (data.callLogs?.length > 0) {
      console.log(`      - Sample: ${JSON.stringify(data.callLogs[0])}`);
    }
    console.log(`   📱 Apps: ${data.apps?.length || 0} entries`);
    if (data.apps?.length > 0) {
      console.log(`      - Sample app: ${JSON.stringify(data.apps[0])}`);
      console.log(`      - Apps with usage > 0: ${data.apps.filter(a => a.usage > 0).length}`);
    }
    console.log(`   📸 Screenshots: ${data.screenshots?.length || 0} entries`);
    console.log(`   ⏱️ App Usage: ${data.appUsage?.length || 0} entries`);

    await db.collection('devices').doc(deviceId).set({
      ...data,
      lastSynced: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    console.log(`\n✅ DATA SUCCESSFULLY STORED IN FIRESTORE`);
    console.log(`   Collection: devices/${deviceId}`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'Device data synced successfully',
      deviceId,
      stored: {
        location: !!data.location,
        messageLogs: data.messageLogs?.length || 0,
        callLogs: data.callLogs?.length || 0,
        apps: data.apps?.length || 0,
        screenshots: data.screenshots?.length || 0,
        appUsage: data.appUsage?.length || 0,
      }
    });
  } catch (error) {
    console.error(`\n❌ ERROR SYNCING DEVICE DATA:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to sync device data',
      details: error.message
    });
  }
});

// Get device data from Firestore
app.get('/api/device/:deviceId/data', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📥 FETCHING DEVICE DATA`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const deviceDoc = await db.collection('devices').doc(deviceId).get();

    if (!deviceDoc.exists) {
      console.log(`⚠️ No data found in Firestore for device: ${deviceId}`);
      console.log(`💡 This is normal if child device hasn't synced data yet`);
      console.log(`💡 Use test endpoint to populate mock data:`);
      console.log(`   POST /api/test/populate-child-data`);
      console.log(`   Body: { "deviceId": "${deviceId}" }`);
      console.log(`${'='.repeat(60)}\n`);
      
      // Return empty data structure instead of 404
      return res.json({ 
        success: true,
        data: null,
        message: 'No data available for this device yet',
        deviceId
      });
    }

    const deviceData = deviceDoc.data();
    
    console.log(`\n✅ DATA FOUND IN FIRESTORE`);
    console.log(`   Device Name: ${deviceData.deviceName || 'N/A'}`);
    console.log(`   OS: ${deviceData.operatingSystem || 'N/A'}`);
    console.log(`   Location: ${deviceData.location ? '✓ YES' : '✗ NO'}`);
    if (deviceData.location) {
      console.log(`      - Address: ${deviceData.location.address}`);
      console.log(`      - Coords: ${deviceData.location.latitude}, ${deviceData.location.longitude}`);
    }
    console.log(`   Battery: ${deviceData.battery?.level || 'N/A'}%`);
    console.log(`   Call Logs: ${deviceData.callLogs?.length || 0}`);
    console.log(`   Message Logs: ${deviceData.messageLogs?.length || 0}`);
    console.log(`   Apps: ${deviceData.apps?.length || 0}`);
    console.log(`   Last Synced: ${deviceData.lastSynced?.toDate?.()?.toISOString() || 'N/A'}`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      data: deviceData,
      deviceId
    });
  } catch (error) {
    console.error(`\n❌ ERROR FETCHING DEVICE DATA:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device data',
      details: error.message
    });
  }
});

// Link parent device to child device
app.post('/api/devices/link', async (req, res) => {
  try {
    const { parentId, childId } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔗 LINKING DEVICES`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Parent ID: ${parentId}`);
    console.log(`Child ID: ${childId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!parentId || !childId) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing parentId or childId' });
    }

    // Update parent device registration with linkedTo field
    await db.collection('deviceRegistrations').doc(parentId).set({
      linkedTo: childId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Update child device registration with linkedTo field (parent)
    await db.collection('deviceRegistrations').doc(childId).set({
      linkedTo: parentId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    console.log(`✅ Devices linked successfully`);
    console.log(`   ${parentId} (parent) <-> ${childId} (child)`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'Devices linked successfully',
      parentId,
      childId
    });
  } catch (error) {
    console.error(`\n❌ ERROR LINKING DEVICES:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to link devices',
      details: error.message
    });
  }
});

// Update app limit for child device
app.post('/api/device/:deviceId/app-limit', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { appName, limit, packageName } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📱 UPDATING APP LIMIT`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`App Name: ${appName}`);
    console.log(`Package Name: ${packageName || 'Not provided'}`);
    console.log(`New Limit: ${limit !== null ? limit + ' minutes' : 'No limit'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!deviceId || !appName) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing deviceId or appName' });
    }

    // Get current device data
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    
    // Get today's date for daily reset tracking
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format
    
    if (!deviceDoc.exists) {
      console.log(`⚠️ Device not found, creating new entry`);
      // Create new device entry with app limit
      await db.collection('devices').doc(deviceId).set({
        apps: [{
          name: appName,
          packageName: packageName || '',
          limit: limit,
          usage: 0,
          blocked: false,
          lastResetDate: today,
          status: 'active',
          timePeriod: 'daily'
        }],
        lastSynced: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Update existing device data
      const deviceData = deviceDoc.data();
      const apps = deviceData.apps || [];
      
      // Find and update the app, or add it if not found
      const appIndex = apps.findIndex(app => app.name === appName);
      
      if (appIndex >= 0) {
        // Update existing app - PRESERVE USAGE, only update limit
        const existingApp = apps[appIndex];
        const shouldResetUsage = existingApp.lastResetDate !== today;
        
        // Keep the current usage from the existing app data
        const currentUsage = shouldResetUsage ? 0 : (existingApp.usage || 0);
        
        apps[appIndex] = {
          ...existingApp,
          limit: limit,
          usage: currentUsage,  // Preserve current usage
          blocked: shouldResetUsage ? false : (limit !== null && currentUsage >= limit),
          lastResetDate: today,
          status: 'active',
          timePeriod: 'daily',
          packageName: packageName || existingApp.packageName || ''
        };
        console.log(`✅ Updated existing app: ${appName} (usage preserved: ${currentUsage} min)`);
      } else {
        // Add new app with limit
        apps.push({
          name: appName,
          packageName: packageName || '',
          limit: limit,
          usage: 0,
          blocked: false,
          lastResetDate: today,
          status: 'active',
          timePeriod: 'daily'
        });
        console.log(`✅ Added new app: ${appName}`);
      }
      
      // Save updated apps array
      await db.collection('devices').doc(deviceId).set({
        apps: apps,
        lastSynced: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
    }

    // Send notification to child device about limit update
    try {
      const childDeviceDoc = await db.collection('deviceRegistrations').doc(deviceId).get();
      if (childDeviceDoc.exists) {
        const limitText = limit !== null ? `${limit} minutes per day` : 'removed';
        await sendNotificationToUser(
          deviceId,
          '📱 App Limit Updated',
          `${appName} limit has been set to ${limitText}`,
          'app_limit_updated',
          { appName, limit, packageName: packageName || '' },
          'high'
        );
        console.log(`✅ Notification sent to child device`);
      }
    } catch (notifError) {
      console.warn(`⚠️ Could not send notification:`, notifError.message);
    }

    console.log(`✅ App limit updated successfully`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'App limit updated successfully',
      deviceId,
      appName,
      limit,
      timePeriod: 'daily',
      status: 'active'
    });
  } catch (error) {
    console.error(`\n❌ ERROR UPDATING APP LIMIT:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to update app limit',
      details: error.message
    });
  }
});

// Update total screen time limit for child device
app.post('/api/device/:deviceId/screen-time-limit', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`⏱️ UPDATING SCREEN TIME LIMIT`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`New Limit: ${limit !== null ? limit + ' minutes' : 'No limit'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!deviceId) {
      console.log(`❌ Missing deviceId`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing deviceId' });
    }

    // Get today's date for daily reset tracking
    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD format

    // Get current device data to check if we need to reset
    const deviceDoc = await db.collection('devices').doc(deviceId).get();
    let currentUsage = 0;
    
    if (deviceDoc.exists) {
      const deviceData = deviceDoc.data();
      const lastResetDate = deviceData.screenTime?.lastResetDate;
      
      // Reset usage if it's a new day
      if (lastResetDate !== today) {
        console.log(`📅 New day detected, resetting screen time usage`);
        currentUsage = 0;
      } else {
        currentUsage = deviceData.screenTime?.totalMinutes || 0;
      }
    }

    // Update device data with new screen time limit
    await db.collection('devices').doc(deviceId).set({
      screenTime: {
        limit: limit,
        totalMinutes: currentUsage,
        lastResetDate: today,
        status: 'active',
        timePeriod: 'daily'
      },
      lastSynced: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });

    // Send notification to child device
    try {
      const childDeviceDoc = await db.collection('deviceRegistrations').doc(deviceId).get();
      if (childDeviceDoc.exists) {
        const limitText = limit !== null ? `${limit} minutes per day` : 'removed';
        await sendNotificationToUser(
          deviceId,
          '⏱️ Screen Time Limit Updated',
          `Total screen time limit has been set to ${limitText}`,
          'screen_time_limit_updated',
          { limit },
          'high'
        );
        console.log(`✅ Notification sent to child device`);
      }
    } catch (notifError) {
      console.warn(`⚠️ Could not send notification:`, notifError.message);
    }

    console.log(`✅ Screen time limit updated successfully`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'Screen time limit updated successfully',
      deviceId,
      limit,
      timePeriod: 'daily',
      status: 'active'
    });
  } catch (error) {
    console.error(`\n❌ ERROR UPDATING SCREEN TIME LIMIT:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to update screen time limit',
      details: error.message
    });
  }
});

// ==================== APP USAGE LIMITS COLLECTION ENDPOINTS ====================

// Set or update app limits for a child device (Parent side)
// Structure: appUsageLimits/<childDeviceId> -> { apps: { packageName: limitMinutes }, updatedAt }
app.post('/api/device/:deviceId/app-usage-limits', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { packageName, limitMinutes } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 SETTING APP USAGE LIMIT`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`Package Name: ${packageName}`);
    console.log(`Limit: ${limitMinutes} minutes`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!deviceId || !packageName) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields: deviceId, packageName' });
    }

    // Get existing document or create new one
    const limitsRef = db.collection('appUsageLimits').doc(deviceId);
    const limitsDoc = await limitsRef.get();
    
    let apps = {};
    if (limitsDoc.exists) {
      apps = limitsDoc.data().apps || {};
    }

    // Update or remove the app limit
    if (limitMinutes === null || limitMinutes === undefined || limitMinutes <= 0) {
      // Remove limit
      delete apps[packageName];
      console.log(`🗑️ Removing limit for ${packageName}`);
    } else {
      // Set limit
      apps[packageName] = limitMinutes;
      console.log(`✅ Setting limit for ${packageName}: ${limitMinutes} minutes`);
    }

    // Save to Firestore
    await limitsRef.set({
      apps: apps,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ App usage limits updated successfully`);
    console.log(`   Total apps with limits: ${Object.keys(apps).length}`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'App usage limit updated successfully',
      deviceId,
      packageName,
      limitMinutes: limitMinutes || null,
      totalAppsWithLimits: Object.keys(apps).length
    });
  } catch (error) {
    console.error(`\n❌ ERROR SETTING APP USAGE LIMIT:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to set app usage limit',
      details: error.message
    });
  }
});

// Get all app usage limits for a child device (Child side)
app.get('/api/device/:deviceId/app-usage-limits', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📥 FETCHING APP USAGE LIMITS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    const limitsDoc = await db.collection('appUsageLimits').doc(deviceId).get();

    if (!limitsDoc.exists) {
      console.log(`⚠️ No limits found for device: ${deviceId}`);
      console.log(`   Returning empty limits (all apps allowed)`);
      console.log(`${'='.repeat(60)}\n`);
      
      return res.json({
        success: true,
        apps: {},
        updatedAt: null,
        message: 'No limits set - all apps allowed'
      });
    }

    const data = limitsDoc.data();
    const apps = data.apps || {};
    
    console.log(`✅ Found limits for ${Object.keys(apps).length} apps`);
    console.log(`   Apps with limits:`, Object.keys(apps).join(', '));
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      apps: apps,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString() || null
    });
  } catch (error) {
    console.error(`\n❌ ERROR FETCHING APP USAGE LIMITS:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to fetch app usage limits',
      details: error.message
    });
  }
});

// Batch update multiple app limits at once (Parent side)
app.post('/api/device/:deviceId/app-usage-limits/batch', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { apps } = req.body; // apps should be an object: { packageName: limitMinutes, ... }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📝 BATCH UPDATING APP USAGE LIMITS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`Apps to update: ${Object.keys(apps || {}).length}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!deviceId || !apps || typeof apps !== 'object') {
      console.log(`❌ Missing or invalid apps object`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing or invalid apps object' });
    }

    // Filter out null/undefined/zero values
    const filteredApps = {};
    Object.keys(apps).forEach(packageName => {
      const limit = apps[packageName];
      if (limit !== null && limit !== undefined && limit > 0) {
        filteredApps[packageName] = limit;
      }
    });

    // Save to Firestore
    await db.collection('appUsageLimits').doc(deviceId).set({
      apps: filteredApps,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    console.log(`✅ Batch update successful`);
    console.log(`   Total apps with limits: ${Object.keys(filteredApps).length}`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'App usage limits updated successfully',
      deviceId,
      totalAppsWithLimits: Object.keys(filteredApps).length
    });
  } catch (error) {
    console.error(`\n❌ ERROR BATCH UPDATING APP USAGE LIMITS:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to batch update app usage limits',
      details: error.message
    });
  }
});

// Delete all app limits for a device (Parent side - reset all limits)
app.delete('/api/device/:deviceId/app-usage-limits', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🗑️ DELETING ALL APP USAGE LIMITS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    await db.collection('appUsageLimits').doc(deviceId).delete();

    console.log(`✅ All app usage limits deleted`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'All app usage limits removed',
      deviceId
    });
  } catch (error) {
    console.error(`\n❌ ERROR DELETING APP USAGE LIMITS:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to delete app usage limits',
      details: error.message
    });
  }
});

// ==================== TEST/DEBUG ENDPOINTS ====================

// Test endpoint to populate mock child device data
app.post('/api/test/populate-child-data', async (req, res) => {
  try {
    const { deviceId } = req.body;
    
    if (!deviceId) {
      return res.status(400).json({ error: 'deviceId is required' });
    }
    
    console.log(`\n🧪 POPULATING TEST DATA FOR: ${deviceId}`);
    
    const mockData = {
      deviceName: 'Test Android Device',
      operatingSystem: 'Android 14',
      network: {
        type: 'wifi',
        ssid: 'Home-WiFi-5G'
      },
      screenTime: {
        totalMinutes: 245,
        limit: 300
      },
      apps: [
        { name: 'YouTube', packageName: 'com.google.android.youtube', usage: 75, limit: 90, blocked: false },
        { name: 'TikTok', packageName: 'com.zhiliaoapp.musically', usage: 50, limit: 60, blocked: false },
        { name: 'Instagram', packageName: 'com.instagram.android', usage: 35, limit: 45, blocked: false },
        { name: 'Chrome', packageName: 'com.android.chrome', usage: 25, limit: null, blocked: false },
        { name: 'WhatsApp', packageName: 'com.whatsapp', usage: 60, limit: null, blocked: false }
      ],
      location: {
        latitude: 34.0522,
        longitude: -118.2437,
        address: '123 Main St, Los Angeles, CA 90012',
        timestamp: new Date().toISOString()
      },
      callLogs: [
        {
          id: '1',
          type: 'incoming',
          number: '+1234567890',
          contact: 'Mom',
          duration: 120,
          timestamp: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: '2',
          type: 'outgoing',
          number: '+0987654321',
          contact: 'Dad',
          duration: 45,
          timestamp: new Date(Date.now() - 7200000).toISOString()
        },
        {
          id: '3',
          type: 'missed',
          number: '+1122334455',
          contact: 'Friend',
          duration: 0,
          timestamp: new Date(Date.now() - 10800000).toISOString()
        }
      ],
      messageLogs: [
        {
          id: '1',
          type: 'received',
          contact: 'Mom',
          preview: 'Don\'t forget to do your homework!',
          timestamp: new Date(Date.now() - 1800000).toISOString()
        },
        {
          id: '2',
          type: 'sent',
          contact: 'Dad',
          preview: 'I\'ll be home by 5pm',
          timestamp: new Date(Date.now() - 3600000).toISOString()
        },
        {
          id: '3',
          type: 'received',
          contact: 'Friend',
          preview: 'Want to play games later?',
          timestamp: new Date(Date.now() - 5400000).toISOString()
        },
        {
          id: '4',
          type: 'sent',
          contact: 'Friend',
          preview: 'Sure! After I finish my tasks',
          timestamp: new Date(Date.now() - 5500000).toISOString()
        }
      ],
      battery: {
        level: 75,
        charging: false
      },
      storage: {
        used: 45,
        total: 128
      },
      lastUpdated: new Date().toISOString()
    };
    
    await db.collection('devices').doc(deviceId).set({
      ...mockData,
      lastSynced: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    
    console.log(`✅ Test data populated for: ${deviceId}`);
    console.log(`   - Location: ${mockData.location.address}`);
    console.log(`   - Call Logs: ${mockData.callLogs.length}`);
    console.log(`   - Message Logs: ${mockData.messageLogs.length}`);
    console.log(`   - Apps: ${mockData.apps.length}`);
    console.log(`   - Battery: ${mockData.battery.level}%`);
    
    res.json({
      success: true,
      message: 'Test data populated successfully',
      deviceId,
      data: mockData
    });
  } catch (error) {
    console.error('Error populating test data:', error);
    res.status(500).json({
      error: 'Failed to populate test data',
      details: error.message
    });
  }
});

// Debug endpoint to check what's in Firestore notifications collection
app.get('/api/debug/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const deviceType = req.query.deviceType || 'child';
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 DEBUG: CHECKING FIRESTORE NOTIFICATIONS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`User ID: ${userId}`);
    console.log(`Device Type: ${deviceType}`);
    
    // Use correct collection
    const collectionName = getNotificationCollection(deviceType);
    console.log(`Collection: ${collectionName}`);
    
    // Get ALL notifications for this user (no limit)
    const notificationsSnapshot = await db.collection(collectionName)
      .where('userId', '==', userId)
      .get();
    
    console.log(`\n📊 FIRESTORE QUERY RESULTS:`);
    console.log(`   Total documents found: ${notificationsSnapshot.size}`);
    
    const notifications = [];
    notificationsSnapshot.forEach((doc, index) => {
      const data = doc.data();
      console.log(`\n   Document ${index + 1}:`);
      console.log(`      ID: ${doc.id}`);
      console.log(`      userId: ${data.userId}`);
      console.log(`      title: ${data.title}`);
      console.log(`      body: ${data.body || data.message}`);
      console.log(`      type: ${data.type}`);
      console.log(`      read: ${data.read}`);
      console.log(`      timestamp: ${data.timestamp?.toDate?.()?.toISOString() || data.sentAt?.toDate?.()?.toISOString() || 'N/A'}`);
      
      notifications.push({
        id: doc.id,
        ...data,
        timestamp: data.timestamp?.toDate?.()?.toISOString() || data.sentAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });
    
    console.log(`\n${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      userId: userId,
      deviceType: deviceType,
      collection: collectionName,
      totalCount: notifications.length,
      notifications: notifications
    });
  } catch (error) {
    console.error(`\n❌ ERROR IN DEBUG ENDPOINT:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Debug query failed',
      details: error.message
    });
  }
});

// Test endpoint to create sample notifications
app.post('/api/test/create-notifications', async (req, res) => {
  try {
    const { userId, deviceType } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    console.log(`\n🧪 CREATING TEST NOTIFICATIONS FOR: ${userId} (${deviceType})`);
    
    // Use correct collection based on device type
    const collectionName = getNotificationCollection(deviceType);
    console.log(`Collection: ${collectionName}`);
    
    const notifications = [];
    
    if (deviceType === 'child') {
      // Notifications for child from parent
      notifications.push({
        userId: userId,
        title: '📱 New App Limit Set',
        body: 'Your parent has set a 60-minute limit on TikTok',
        message: 'Your parent has set a 60-minute limit on TikTok',
        type: 'limit_set',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'normal'
      });
      
      notifications.push({
        userId: userId,
        title: '🔒 App Blocked',
        body: 'Instagram has been blocked by your parent',
        message: 'Instagram has been blocked by your parent',
        type: 'app_blocked',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'high'
      });
      
      notifications.push({
        userId: userId,
        title: '✅ Task Assigned',
        body: 'New task: Clean your room',
        message: 'New task: Clean your room',
        type: 'new_task',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'normal'
      });
    } else {
      // Notifications for parent from child
      notifications.push({
        userId: userId,
        title: '🚨 SOS Alert',
        body: 'Your child needs immediate help!',
        message: 'Your child needs immediate help!',
        type: 'sos',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'high'
      });
      
      notifications.push({
        userId: userId,
        title: '📍 Geofence Alert',
        body: 'Your child has left the "Home" safe zone',
        message: 'Your child has left the "Home" safe zone',
        type: 'geofence_alert',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'high'
      });
      
      notifications.push({
        userId: userId,
        title: '🔋 Low Battery',
        body: 'Child device battery is at 15%',
        message: 'Child device battery is at 15%',
        type: 'battery_low',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'normal'
      });
      
      notifications.push({
        userId: userId,
        title: '✅ Task Completed',
        body: 'Your child completed: Finish homework',
        message: 'Your child completed: Finish homework',
        type: 'task_completed',
        read: false,
        sentAt: admin.firestore.FieldValue.serverTimestamp(),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        priority: 'normal'
      });
    }
    
    // Store all notifications in correct collection
    const batch = db.batch();
    notifications.forEach(notification => {
      const notificationRef = db.collection(collectionName).doc();
      batch.set(notificationRef, notification);
    });
    
    await batch.commit();
    
    console.log(`✅ Created ${notifications.length} test notifications in ${collectionName}`);
    
    res.json({
      success: true,
      message: `Created ${notifications.length} test notifications`,
      count: notifications.length,
      collection: collectionName
    });
  } catch (error) {
    console.error('Error creating test notifications:', error);
    res.status(500).json({
      error: 'Failed to create test notifications',
      details: error.message
    });
  }
});

// ==================== DEVICE TRACKING ENDPOINTS ====================

// Track device login
app.post('/api/devices/track-login', async (req, res) => {
  try {
    const { deviceId, platform, deviceModel, userId, userRole, lastLoginAt, isCurrentDevice } = req.body;
    
    console.log(`📱 Tracking login for device: ${deviceId}`);
    console.log(`   User: ${userId} (${userRole})`);
    console.log(`   Platform: ${platform}`);
    console.log(`   Model: ${deviceModel}`);
    
    if (!deviceId || !userId) {
      return res.status(400).json({ error: 'Missing required fields: deviceId, userId' });
    }
    
    const deviceLoginData = {
      deviceId,
      platform: platform || 'unknown',
      deviceModel: deviceModel || 'unknown',
      userId,
      userRole: userRole || 'unknown',
      lastLoginAt: lastLoginAt || new Date().toISOString(),
      isCurrentDevice: isCurrentDevice || false,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await db.collection('deviceLogins').doc(deviceId).set(deviceLoginData, { merge: true });
    
    console.log(`✅ Device login tracked: ${deviceId}`);
    
    res.json({
      success: true,
      message: 'Device login tracked successfully',
      deviceId
    });
  } catch (error) {
    console.error('Error tracking device login:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to track device login',
      details: error.message
    });
  }
});

// Helper function to get correct notification collection
const getNotificationCollection = (deviceType) => {
  return deviceType === 'parent' ? 'parentNotifications' : 'childNotifications';
};

// Helper function to determine device type from userId
const getDeviceTypeForUser = async (userId) => {
  try {
    const deviceDoc = await db.collection('deviceRegistrations').doc(userId).get();
    if (deviceDoc.exists) {
      return deviceDoc.data().deviceType || 'child';
    }
    return 'child'; // default
  } catch (error) {
    console.error('Error getting device type:', error);
    return 'child';
  }
};

// Helper function to send notification (stores in DB + sends FCM push)
const sendNotificationToUser = async (targetUserId, title, body, type, data = {}, priority = 'high', fromUserId = null) => {
  try {
    // Determine target device type
    const targetDeviceDoc = await db.collection('deviceRegistrations').doc(targetUserId).get();
    if (!targetDeviceDoc.exists) {
      throw new Error('Target user not found');
    }
    
    const targetDeviceType = targetDeviceDoc.data().deviceType;
    const collectionName = getNotificationCollection(targetDeviceType);
    
    // Store notification in database
    const notificationRef = db.collection(collectionName).doc();
    const notificationData = {
      userId: targetUserId,
      title: title,
      body: body,
      message: body, // For compatibility
      type: type,
      read: false,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      data: data,
      priority: priority
    };
    
    // Add sender info if provided
    if (fromUserId) {
      const fromDeviceDoc = await db.collection('deviceRegistrations').doc(fromUserId).get();
      if (fromDeviceDoc.exists) {
        const fromDeviceType = fromDeviceDoc.data().deviceType;
        if (fromDeviceType === 'parent') {
          notificationData.fromParentId = fromUserId;
        } else {
          notificationData.fromChildId = fromUserId;
        }
      }
    }
    
    await notificationRef.set(notificationData);
    console.log(`✅ Notification stored in ${collectionName}: ${notificationRef.id}`);
    
    // Try to send FCM push notification
    let fcmMessageId = null;
    try {
      const fcmToken = targetDeviceDoc.data().fcmToken;
      
      if (fcmToken) {
        // Convert all data fields to strings for FCM compatibility
        const fcmData = {
          notificationId: notificationRef.id,
          type: type,
          userId: targetUserId,
          priority: priority,
        };
        
        // Add all custom data fields as strings
        Object.keys(data).forEach(key => {
          fcmData[key] = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
        });
        
        const message = {
          token: fcmToken,
          notification: {
            title: title,
            body: body,
          },
          data: fcmData,
          android: {
            priority: priority === 'high' ? 'high' : 'normal',
            notification: {
              sound: 'default',
              channelId: priority === 'high' ? 'high_priority' : 'default',
            },
          },
        };
        
        fcmMessageId = await admin.messaging().send(message);
        console.log(`✅ FCM push notification sent: ${fcmMessageId}`);
      } else {
        console.log(`⚠️ No FCM token found for user: ${targetUserId}`);
      }
    } catch (fcmError) {
      console.error(`⚠️ Failed to send FCM push notification:`, fcmError.message);
      console.error(`   Error details:`, fcmError);
    }
    
    return {
      notificationId: notificationRef.id,
      messageId: fcmMessageId || notificationRef.id,
      collection: collectionName
    };
  } catch (error) {
    console.error('Error in sendNotificationToUser:', error);
    throw error;
  }
};

// ==================== NOTIFICATION ENDPOINTS ====================

// Get notifications for a user
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const limit = parseInt(req.query.limit) || 15;
    const deviceType = req.query.deviceType || 'parent';
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔔 FETCHING NOTIFICATIONS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`User ID: ${userId}`);
    console.log(`Device Type: ${deviceType}`);
    console.log(`Limit: ${limit}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log(`Query params:`, req.query);
    
    // Use separate collections for parent and child
    const collectionName = deviceType === 'parent' ? 'parentNotifications' : 'childNotifications';
    console.log(`Collection: ${collectionName}`);
    console.log(`Query: db.collection('${collectionName}').where('userId', '==', '${userId}')`);
    
    let notificationsSnapshot;
    
    try {
      // Try with orderBy first (requires Firestore index)
      console.log('Attempting query with orderBy...');
      notificationsSnapshot = await db.collection(collectionName)
        .where('userId', '==', userId)
        .orderBy('timestamp', 'desc')
        .limit(limit)
        .get();
      console.log(`✅ Query with orderBy succeeded, found ${notificationsSnapshot.size} documents`);
    } catch (indexError) {
      // If index doesn't exist, fetch without orderBy and sort in memory
      console.log('⚠️ Firestore index not found, fetching without orderBy');
      console.log('Index error:', indexError.message);
      notificationsSnapshot = await db.collection(collectionName)
        .where('userId', '==', userId)
        .get();
      console.log(`✅ Query without orderBy succeeded, found ${notificationsSnapshot.size} documents`);
    }
    
    console.log(`\n📊 RAW FIRESTORE RESULTS:`);
    console.log(`   Total documents: ${notificationsSnapshot.size}`);
    
    const notifications = [];
    notificationsSnapshot.forEach((doc, index) => {
      const data = doc.data();
      
      console.log(`\n   Document ${index + 1}:`);
      console.log(`      ID: ${doc.id}`);
      console.log(`      userId: ${data.userId}`);
      console.log(`      title: ${data.title}`);
      console.log(`      type: ${data.type}`);
      console.log(`      read: ${data.read}`);
      console.log(`      timestamp: ${data.timestamp?.toDate?.()?.toISOString() || data.sentAt?.toDate?.()?.toISOString() || 'N/A'}`);
      
      // Handle both old and new schema
      const message = data.message || data.body || '';
      const timestamp = data.timestamp || data.sentAt;
      
      notifications.push({
        id: doc.id,
        title: data.title,
        message: message,
        body: message, // Include both for compatibility
        type: data.type || 'info',
        read: data.read || false,
        timestamp: timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
        userId: data.userId,
        data: data.data || {},
        fromParentId: data.fromParentId,
        fromChildId: data.fromChildId
      });
    });
    
    // Sort in memory (in case we didn't use orderBy)
    notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    // Apply limit if we fetched all
    const limitedNotifications = notifications.slice(0, limit);
    
    console.log(`\n✅ RETURNING ${limitedNotifications.length} NOTIFICATIONS TO CLIENT`);
    if (limitedNotifications.length > 0) {
      console.log(`   First notification:`);
      console.log(`      - Title: ${limitedNotifications[0].title}`);
      console.log(`      - Message: ${limitedNotifications[0].message}`);
      console.log(`      - Type: ${limitedNotifications[0].type}`);
      console.log(`      - Read: ${limitedNotifications[0].read}`);
      console.log(`      - Time: ${limitedNotifications[0].timestamp}`);
    } else {
      console.log(`   ❌ NO NOTIFICATIONS FOUND!`);
      console.log(`   💡 Possible issues:`);
      console.log(`      1. Wrong collection: ${collectionName}`);
      console.log(`      2. Wrong userId: ${userId}`);
      console.log(`      3. Notifications don't have userId field`);
      console.log(`   💡 Debug:`);
      console.log(`      GET /api/debug/notifications/${userId}?deviceType=${deviceType}`);
    }
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      notifications: limitedNotifications
    });
  } catch (error) {
    console.error(`\n❌ ERROR FETCHING NOTIFICATIONS:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    
    // Return empty array instead of error to prevent frontend crashes
    res.json({
      success: true,
      notifications: [],
      error: error.message
    });
  }
});

// Get unread notification count
app.get('/api/notifications/:userId/unread-count', async (req, res) => {
  try {
    const { userId } = req.params;
    const deviceType = req.query.deviceType || 'parent';
    
    console.log(`🔔 Fetching unread count for user: ${userId} (${deviceType})`);
    
    // Use separate collections
    const collectionName = deviceType === 'parent' ? 'parentNotifications' : 'childNotifications';
    
    const notificationsSnapshot = await db.collection(collectionName)
      .where('userId', '==', userId)
      .where('read', '==', false)
      .get();
    
    const count = notificationsSnapshot.size;
    
    console.log(`✅ Unread notifications in ${collectionName}: ${count}`);
    
    res.json({
      success: true,
      count,
      unreadCount: count // Include both for compatibility
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.json({
      success: true,
      count: 0,
      unreadCount: 0
    });
  }
});

// Mark notification as read
app.put('/api/notifications/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const { userId, deviceType } = req.body;
    
    console.log(`✓ Marking notification as read: ${notificationId} (${deviceType})`);
    
    // Use separate collections
    const collectionName = deviceType === 'parent' ? 'parentNotifications' : 'childNotifications';
    
    const notificationRef = db.collection(collectionName).doc(notificationId);
    const notificationDoc = await notificationRef.get();
    
    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    await notificationRef.update({
      read: true,
      readAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Notification marked as read in ${collectionName}: ${notificationId}`);
    
    res.json({
      success: true,
      message: 'Notification marked as read'
    });
  } catch (error) {
    console.error('Error marking notification as read:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to mark notification as read',
      details: error.message
    });
  }
});

// Mark all notifications as read for a user
app.put('/api/notifications/:userId/read-all', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`✓ Marking all notifications as read for user: ${userId}`);
    
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .where('read', '==', false)
      .get();
    
    const batch = db.batch();
    let count = 0;
    
    notificationsSnapshot.forEach(doc => {
      batch.update(doc.ref, {
        read: true,
        readAt: admin.firestore.FieldValue.serverTimestamp()
      });
      count++;
    });
    
    await batch.commit();
    
    console.log(`✅ Marked ${count} notifications as read for user: ${userId}`);
    
    res.json({
      success: true,
      message: `${count} notifications marked as read`,
      count
    });
  } catch (error) {
    console.error('Error marking all notifications as read:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to mark notifications as read',
      details: error.message
    });
  }
});

// Send SOS alert from child to parent
app.post('/api/notifications/sos', async (req, res) => {
  try {
    const { childId, location } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🚨 SOS ALERT RECEIVED`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Child ID: ${childId}`);
    console.log(`Location: ${location ? `${location.latitude}, ${location.longitude}` : 'Not provided'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);

    if (!childId) {
      console.log(`❌ Missing childId`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'childId is required' });
    }

    // Find parent device linked to this child
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    
    if (!childDeviceDoc.exists) {
      console.log(`⚠️ Child device not found: ${childId}`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(404).json({ error: 'Child device not found' });
    }

    const childDevice = childDeviceDoc.data();
    const parentId = childDevice.linkedTo;

    if (!parentId) {
      console.log(`⚠️ No parent linked to child: ${childId}`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(404).json({ error: 'No parent linked to this child' });
    }

    console.log(`📱 Found parent: ${parentId}`);

    // Get parent's FCM token
    const parentDeviceDoc = await db.collection('deviceRegistrations').doc(parentId).get();
    
    if (!parentDeviceDoc.exists || !parentDeviceDoc.data().fcmToken) {
      console.log(`⚠️ Parent device not found or no FCM token`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(404).json({ error: 'Parent device not found or not registered for notifications' });
    }

    const parentFcmToken = parentDeviceDoc.data().fcmToken;

    // Create notification message
    const locationText = location 
      ? `Location: ${location.latitude.toFixed(4)}, ${location.longitude.toFixed(4)}`
      : 'Location not available';

    // Try to send FCM notification (optional - don't fail if this doesn't work)
    let fcmMessageId = null;
    try {
      const message = {
        token: parentFcmToken,
        notification: {
          title: '🚨 EMERGENCY SOS ALERT',
          body: `Your child needs immediate help! ${locationText}`,
        },
        data: {
          type: 'sos',
          childId: childId,
          latitude: location?.latitude?.toString() || '',
          longitude: location?.longitude?.toString() || '',
          timestamp: new Date().toISOString(),
        },
        android: {
          priority: 'high',
          notification: {
            sound: 'default',
            priority: 'max',
            channelId: 'emergency',
          },
        },
      };

      fcmMessageId = await admin.messaging().send(message);
      console.log(`✅ SOS notification sent to parent via FCM:`, fcmMessageId);
    } catch (fcmError) {
      console.log(`⚠️ FCM push notification failed (continuing anyway):`, fcmError.message);
    }

    // Store notification in database (parent notifications collection)
    const notificationRef = db.collection('parentNotifications').doc();
    await notificationRef.set({
      userId: parentId,
      title: '🚨 EMERGENCY SOS ALERT',
      body: `Your child needs immediate help! ${locationText}`,
      message: `Your child needs immediate help! ${locationText}`,
      type: 'sos',
      read: false,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      childId: childId,
      fromChildId: childId,
      location: location || null,
      priority: 'high'
    });

    console.log(`✅ SOS notification stored in database`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'SOS alert sent successfully',
      messageId: fcmMessageId || notificationRef.id,
      notificationId: notificationRef.id
    });
  } catch (error) {
    console.error(`\n❌ ERROR SENDING SOS ALERT:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to send SOS alert',
      details: error.message
    });
  }
});

// Send notification to a user (stores in DB and sends FCM push)
app.post('/api/notifications/send', async (req, res) => {
  try {
    const { targetUserId, title, body, data, priority, deviceType } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📤 SENDING NOTIFICATION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Target User: ${targetUserId}`);
    console.log(`Title: ${title}`);
    console.log(`Body: ${body}`);
    console.log(`Device Type: ${deviceType || 'auto-detect'}`);
    console.log(`Priority: ${priority || 'normal'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    if (!targetUserId || !title || !body) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields: targetUserId, title, body' });
    }
    
    // Determine collection based on deviceType or auto-detect from device registration
    let collectionName = 'childNotifications'; // default
    if (deviceType) {
      collectionName = deviceType === 'parent' ? 'parentNotifications' : 'childNotifications';
    } else {
      // Auto-detect from device registration
      const deviceDoc = await db.collection('deviceRegistrations').doc(targetUserId).get();
      if (deviceDoc.exists) {
        const deviceData = deviceDoc.data();
        collectionName = deviceData.deviceType === 'parent' ? 'parentNotifications' : 'childNotifications';
      }
    }
    
    console.log(`Collection: ${collectionName}`);
    
    // Store notification in database using correct schema
    const notificationRef = db.collection(collectionName).doc();
    const notificationData = {
      userId: targetUserId,
      title: title,
      body: body,
      message: body,
      type: data?.type || 'info',
      read: false,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      data: data || {},
      priority: priority || 'normal'
    };
    
    await notificationRef.set(notificationData);
    console.log(`✅ Notification stored in ${collectionName}: ${notificationRef.id}`);
    
    // Try to send FCM push notification
    let fcmMessageId = null;
    try {
      const targetDeviceDoc = await db.collection('deviceRegistrations').doc(targetUserId).get();
      
      if (targetDeviceDoc.exists && targetDeviceDoc.data().fcmToken) {
        const fcmToken = targetDeviceDoc.data().fcmToken;
        
        // Convert all data fields to strings for FCM compatibility
        const fcmData = {
          notificationId: notificationRef.id,
          type: data?.type || 'info',
        };
        
        // Add all custom data fields as strings
        if (data) {
          Object.keys(data).forEach(key => {
            fcmData[key] = typeof data[key] === 'string' ? data[key] : JSON.stringify(data[key]);
          });
        }
        
        const message = {
          token: fcmToken,
          notification: {
            title: title,
            body: body,
          },
          data: fcmData,
          android: {
            priority: priority === 'high' ? 'high' : 'normal',
            notification: {
              sound: 'default',
              channelId: priority === 'high' ? 'high_priority' : 'default',
            },
          },
        };
        
        fcmMessageId = await admin.messaging().send(message);
        console.log(`✅ FCM push notification sent: ${fcmMessageId}`);
      } else {
        console.log(`⚠️ No FCM token found for user: ${targetUserId}`);
      }
    } catch (fcmError) {
      console.error(`⚠️ Failed to send FCM push notification:`, fcmError.message);
      // Continue even if FCM fails - notification is still stored in DB
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      messageId: fcmMessageId || notificationRef.id,
      notificationId: notificationRef.id,
      collection: collectionName,
      notification: {
        id: notificationRef.id,
        ...notificationData,
        sentAt: new Date().toISOString(),
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error(`\n❌ ERROR SENDING NOTIFICATION:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to send notification',
      details: error.message
    });
  }
});

// Send notification from child to parent
app.post('/api/notifications/send-to-parent', async (req, res) => {
  try {
    const { childId, title, body, data } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📤 CHILD → PARENT NOTIFICATION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Child ID: ${childId}`);
    console.log(`Title: ${title}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    if (!childId || !title || !body) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields: childId, title, body' });
    }
    
    // Find parent linked to this child
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    
    if (!childDeviceDoc.exists) {
      console.log(`⚠️ Child device not found: ${childId}`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(404).json({ error: 'Child device not found' });
    }
    
    const parentId = childDeviceDoc.data().linkedTo;
    
    if (!parentId) {
      console.log(`⚠️ No parent linked to child: ${childId}`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(404).json({ error: 'No parent linked to this child' });
    }
    
    console.log(`📱 Found parent: ${parentId}`);
    
    // Store notification for parent using correct schema
    const notificationRef = db.collection('parentNotifications').doc();
    const notificationData = {
      userId: parentId,
      title: title,
      body: body,
      message: body,
      type: data?.type || 'info',
      read: false,
      sentAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      fromChildId: childId,
      data: data || {},
      priority: 'high'
    };
    
    await notificationRef.set(notificationData);
    console.log(`✅ Notification stored for parent: ${notificationRef.id}`);
    
    // Try to send FCM push notification to parent
    let fcmMessageId = null;
    try {
      const parentDeviceDoc = await db.collection('deviceRegistrations').doc(parentId).get();
      
      if (parentDeviceDoc.exists && parentDeviceDoc.data().fcmToken) {
        const fcmToken = parentDeviceDoc.data().fcmToken;
        
        const message = {
          token: fcmToken,
          notification: {
            title: title,
            body: body,
          },
          data: {
            notificationId: notificationRef.id,
            fromChildId: childId,
            ...(data || {}),
          },
          android: {
            priority: 'high',
          },
        };
        
        fcmMessageId = await admin.messaging().send(message);
        console.log(`✅ FCM push notification sent to parent: ${fcmMessageId}`);
      } else {
        console.log(`⚠️ No FCM token found for parent: ${parentId}`);
      }
    } catch (fcmError) {
      console.error(`⚠️ Failed to send FCM push notification:`, fcmError.message);
    }
    
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      messageId: fcmMessageId || notificationRef.id,
      notificationId: notificationRef.id,
      parentId: parentId
    });
  } catch (error) {
    console.error(`\n❌ ERROR SENDING NOTIFICATION TO PARENT:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to send notification to parent',
      details: error.message
    });
  }
});

// Notify parent about app installation
app.post('/api/notifications/app-installed', async (req, res) => {
  try {
    const { childId, appName, packageName } = req.body;
    
    if (!childId || !appName) {
      return res.status(400).json({ error: 'Missing required fields: childId, appName' });
    }
    
    console.log(`📱 App installed notification: ${appName} on child: ${childId}`);
    
    // Find parent
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    if (!childDeviceDoc.exists || !childDeviceDoc.data().linkedTo) {
      return res.status(404).json({ error: 'Parent not found' });
    }
    
    const parentId = childDeviceDoc.data().linkedTo;
    
    // Send notification to parent
    const result = await sendNotificationToUser(
      parentId,
      '📱 New App Installed',
      `${appName} was installed on your child's device`,
      'app_installed',
      { appName, packageName },
      'normal',
      childId
    );
    
    console.log(`✅ App installed notification sent to parent`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending app installed notification:', error);
    res.status(500).json({
      error: 'Failed to send notification',
      details: error.message
    });
  }
});

// Notify parent when child exceeds app usage limit
app.post('/api/notifications/app-limit-exceeded', async (req, res) => {
  try {
    const { childId, appName, usage, limit } = req.body;
    
    if (!childId || !appName) {
      return res.status(400).json({ error: 'Missing required fields: childId, appName' });
    }
    
    console.log(`⚠️ App limit exceeded: ${appName} on child: ${childId} (${usage}/${limit} min)`);
    
    // Find parent
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    if (!childDeviceDoc.exists || !childDeviceDoc.data().linkedTo) {
      return res.status(404).json({ error: 'Parent not found' });
    }
    
    const parentId = childDeviceDoc.data().linkedTo;
    
    // Send notification to parent
    const result = await sendNotificationToUser(
      parentId,
      '⏱️ App Limit Reached',
      `${appName} has reached its ${limit} minute daily limit`,
      'app_limit_exceeded',
      { appName, usage, limit },
      'normal',
      childId
    );
    
    console.log(`✅ App limit exceeded notification sent to parent`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending app limit exceeded notification:', error);
    res.status(500).json({
      error: 'Failed to send notification',
      details: error.message
    });
  }
});

// Notify parent about low battery
app.post('/api/notifications/battery-low', async (req, res) => {
  try {
    const { childId, batteryLevel } = req.body;
    
    if (!childId || batteryLevel === undefined) {
      return res.status(400).json({ error: 'Missing required fields: childId, batteryLevel' });
    }
    
    console.log(`🔋 Low battery notification: ${batteryLevel}% on child: ${childId}`);
    
    // Find parent
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    if (!childDeviceDoc.exists || !childDeviceDoc.data().linkedTo) {
      return res.status(404).json({ error: 'Parent not found' });
    }
    
    const parentId = childDeviceDoc.data().linkedTo;
    
    // Send notification to parent
    const result = await sendNotificationToUser(
      parentId,
      '🔋 Low Battery Alert',
      `Child's device battery is at ${batteryLevel}%`,
      'battery_low',
      { batteryLevel },
      'high',
      childId
    );
    
    console.log(`✅ Low battery notification created: ${result.notificationId}`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending battery low notification:', error);
    res.status(500).json({
      error: 'Failed to send battery low notification',
      details: error.message
    });
  }
});

// Notify child about limit set by parent
app.post('/api/notifications/limit-set', async (req, res) => {
  try {
    const { childId, parentId, limitType, limitValue } = req.body;
    
    if (!childId || !parentId || !limitType || limitValue === undefined) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    console.log(`⏱️ Limit set notification: ${limitType} = ${limitValue} for child: ${childId}`);
    
    // Send notification to child
    const result = await sendNotificationToUser(
      childId,
      '⏱️ New Limit Set',
      `Your parent set a ${limitType} limit: ${limitValue}`,
      'limit_set',
      { limitType, limitValue },
      'normal',
      parentId
    );
    
    console.log(`✅ Limit set notification created: ${result.notificationId}`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending limit set notification:', error);
    res.status(500).json({
      error: 'Failed to send limit set notification',
      details: error.message
    });
  }
});

// Notify child about app being blocked
app.post('/api/notifications/app-blocked', async (req, res) => {
  try {
    const { childId, parentId, appName } = req.body;
    
    if (!childId || !parentId || !appName) {
      return res.status(400).json({ error: 'Missing required fields: childId, parentId, appName' });
    }
    
    console.log(`🔒 App blocked notification: ${appName} for child: ${childId}`);
    
    // Send notification to child
    const result = await sendNotificationToUser(
      childId,
      '🔒 App Blocked',
      `${appName} has been blocked by your parent`,
      'app_blocked',
      { appName },
      'high',
      parentId
    );
    
    console.log(`✅ App blocked notification created: ${result.notificationId}`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending app blocked notification:', error);
    res.status(500).json({
      error: 'Failed to send app blocked notification',
      details: error.message
    });
  }
});

// Notify parent about geofence alert
app.post('/api/notifications/geofence-alert', async (req, res) => {
  try {
    const { childId, alertType, location, zoneName } = req.body;
    
    if (!childId || !alertType) {
      return res.status(400).json({ error: 'Missing required fields: childId, alertType' });
    }
    
    console.log(`📍 Geofence alert: ${alertType} ${zoneName || 'zone'} for child: ${childId}`);
    
    // Find parent
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    if (!childDeviceDoc.exists || !childDeviceDoc.data().linkedTo) {
      return res.status(404).json({ error: 'Parent not found' });
    }
    
    const parentId = childDeviceDoc.data().linkedTo;
    
    const action = alertType === 'entered' ? 'entered' : 'left';
    const zone = zoneName || 'a safe zone';
    
    // Send notification to parent
    const result = await sendNotificationToUser(
      parentId,
      '📍 Geofence Alert',
      `Your child ${action} ${zone}`,
      'geofence_alert',
      { alertType, location, zoneName },
      'high',
      childId
    );
    
    console.log(`✅ Geofence alert notification created: ${result.notificationId}`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending geofence alert:', error);
    res.status(500).json({
      error: 'Failed to send geofence alert',
      details: error.message
    });
  }
});

// Notify child about new task assigned by parent
app.post('/api/notifications/task-assigned', async (req, res) => {
  try {
    const { childId, parentId, taskText } = req.body;
    
    if (!childId || !parentId || !taskText) {
      return res.status(400).json({ error: 'Missing required fields: childId, parentId, taskText' });
    }
    
    console.log(`✅ Task assigned notification: "${taskText}" for child: ${childId}`);
    
    // Send notification to child
    const result = await sendNotificationToUser(
      childId,
      '✅ New Task Assigned',
      `Your parent assigned you a task: ${taskText}`,
      'task_assigned',
      { taskText },
      'normal',
      parentId
    );
    
    console.log(`✅ Task assigned notification created: ${result.notificationId}`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending task assigned notification:', error);
    res.status(500).json({
      error: 'Failed to send task assigned notification',
      details: error.message
    });
  }
});

// Notify parent about task completed by child
app.post('/api/notifications/task-completed', async (req, res) => {
  try {
    const { childId, taskText } = req.body;
    
    if (!childId || !taskText) {
      return res.status(400).json({ error: 'Missing required fields: childId, taskText' });
    }
    
    console.log(`✅ Task completed notification: "${taskText}" by child: ${childId}`);
    
    // Find parent
    const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
    if (!childDeviceDoc.exists || !childDeviceDoc.data().linkedTo) {
      return res.status(404).json({ error: 'Parent not found' });
    }
    
    const parentId = childDeviceDoc.data().linkedTo;
    
    // Send notification to parent
    const result = await sendNotificationToUser(
      parentId,
      '✅ Task Completed',
      `Your child completed: ${taskText}`,
      'task_completed',
      { taskText },
      'normal',
      childId
    );
    
    console.log(`✅ Task completed notification created: ${result.notificationId}`);
    
    res.json({
      success: true,
      messageId: result.messageId,
      notificationId: result.notificationId
    });
  } catch (error) {
    console.error('Error sending task completed notification:', error);
    res.status(500).json({
      error: 'Failed to send task completed notification',
      details: error.message
    });
  }
});

// Cleanup old notifications (keep only last 30)
app.post('/api/notifications/:userId/cleanup', async (req, res) => {
  try {
    const { userId } = req.params;
    const deviceType = req.query.deviceType;
    
    console.log(`🧹 Cleaning up old notifications for: ${userId}`);
    
    // Determine collection
    let collectionName = 'childNotifications';
    if (deviceType) {
      collectionName = getNotificationCollection(deviceType);
    } else {
      const userDeviceType = await getDeviceTypeForUser(userId);
      collectionName = getNotificationCollection(userDeviceType);
    }
    
    console.log(`   Collection: ${collectionName}`);
    
    // Get all notifications for user, sorted by timestamp
    const notificationsSnapshot = await db.collection(collectionName)
      .where('userId', '==', userId)
      .get();
    
    const notifications = [];
    notificationsSnapshot.forEach(doc => {
      const data = doc.data();
      const timestamp = data.timestamp || data.sentAt;
      notifications.push({
        id: doc.id,
        timestamp: timestamp?.toDate?.()?.getTime() || 0
      });
    });
    
    // Sort by timestamp descending
    notifications.sort((a, b) => b.timestamp - a.timestamp);
    
    // Keep only last 30, delete the rest
    const toDelete = notifications.slice(30);
    
    if (toDelete.length > 0) {
      const batch = db.batch();
      toDelete.forEach(notification => {
        batch.delete(db.collection(collectionName).doc(notification.id));
      });
      await batch.commit();
      
      console.log(`✅ Deleted ${toDelete.length} old notifications for: ${userId}`);
    } else {
      console.log(`✅ No cleanup needed for: ${userId}`);
    }
    
    res.json({
      success: true,
      deletedCount: toDelete.length,
      remainingCount: Math.min(notifications.length, 30)
    });
  } catch (error) {
    console.error('Error cleaning up notifications:', error);
    res.status(500).json({
      error: 'Failed to cleanup notifications',
      details: error.message
    });
  }
});

// Delete a notification
app.delete('/api/notifications/:notificationId', async (req, res) => {
  try {
    const { notificationId } = req.params;
    const deviceType = req.query.deviceType;
    
    console.log(`🗑️ Deleting notification: ${notificationId} (${deviceType})`);
    
    if (!deviceType) {
      return res.status(400).json({ error: 'deviceType query parameter is required' });
    }
    
    const collectionName = getNotificationCollection(deviceType);
    await db.collection(collectionName).doc(notificationId).delete();
    
    console.log(`✅ Notification deleted from ${collectionName}: ${notificationId}`);
    
    res.json({
      success: true,
      message: 'Notification deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting notification:', error);
    res.status(500).json({
      error: 'Failed to delete notification',
      details: error.message
    });
  }
});

// Create a notification (for testing or internal use)
app.post('/api/notifications', async (req, res) => {
  try {
    const { userId, title, message, type } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📬 CREATING NOTIFICATION`);
    console.log(`${'='.repeat(60)}`);
    console.log(`User ID: ${userId}`);
    console.log(`Title: ${title}`);
    console.log(`Message: ${message}`);
    console.log(`Type: ${type || 'info'}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    if (!userId || !title || !message) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields: userId, title, message' });
    }
    
    const notificationRef = db.collection('notifications').doc();
    const notificationData = {
      userId,
      title,
      message,
      type: type || 'info',
      read: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await notificationRef.set(notificationData);
    
    console.log(`✅ Notification created successfully`);
    console.log(`   ID: ${notificationRef.id}`);
    console.log(`   Stored in: notifications/${notificationRef.id}`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      notificationId: notificationRef.id,
      notification: {
        id: notificationRef.id,
        ...notificationData,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error(`\n❌ ERROR CREATING NOTIFICATION:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({ 
      success: false,
      error: 'Failed to create notification',
      details: error.message
    });
  }
});

// ==================== TASK ENDPOINTS ====================

// Get tasks for a device
app.get('/api/device/:deviceId/tasks', async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📋 FETCHING TASKS`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Device ID: ${deviceId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    // Simplified query without orderBy to avoid index requirement
    const tasksSnapshot = await db.collection('tasks')
      .where('deviceId', '==', deviceId)
      .get();
    
    const tasks = [];
    tasksSnapshot.forEach(doc => {
      const data = doc.data();
      const task = {
        id: doc.id,
        text: data.text,
        completed: data.completed || false,
        deviceId: data.deviceId,
        parentId: data.parentId,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString()
      };
      tasks.push(task);
      console.log(`   Task ${doc.id}:`, {
        text: task.text,
        completed: task.completed,
        createdAt: task.createdAt
      });
    });
    
    // Sort in memory instead of in query
    tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    
    console.log(`\n✅ Returning ${tasks.length} tasks`);
    console.log(`Response:`, JSON.stringify({ success: true, tasks }, null, 2));
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    console.error('❌ Error fetching tasks:', error);
    console.log(`${'='.repeat(60)}\n`);
    res.json({ 
      success: true,
      tasks: [] // Return empty array to prevent frontend crashes
    });
  }
});

// Add a task
app.post('/api/device/:deviceId/tasks', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { text, parentId } = req.body;
    
    if (!text) {
      return res.status(400).json({ error: 'Task text is required' });
    }
    
    console.log(`➕ Adding task for device: ${deviceId}`);
    
    const taskRef = db.collection('tasks').doc();
    const taskData = {
      text,
      completed: false,
      deviceId,
      parentId: parentId || null,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };
    
    await taskRef.set(taskData);
    
    console.log(`✅ Task added: ${taskRef.id}`);
    
    res.json({
      success: true,
      taskId: taskRef.id,
      task: {
        id: taskRef.id,
        ...taskData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error adding task:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to add task',
      details: error.message
    });
  }
});

// Update a task
app.put('/api/device/:deviceId/tasks/:taskId', async (req, res) => {
  try {
    const { deviceId, taskId } = req.params;
    const { completed } = req.body;
    
    console.log(`✏️ Updating task ${taskId} for device: ${deviceId}`);
    
    const taskRef = db.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    
    if (!taskDoc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    await taskRef.update({
      completed,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Task updated: ${taskId}`);
    
    const updatedTask = await taskRef.get();
    const data = updatedTask.data();
    
    res.json({
      success: true,
      task: {
        id: taskId,
        ...data,
        createdAt: data.createdAt?.toDate?.()?.toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString()
      }
    });
  } catch (error) {
    console.error('Error updating task:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to update task',
      details: error.message
    });
  }
});

// Delete a task
app.delete('/api/device/:deviceId/tasks/:taskId', async (req, res) => {
  try {
    const { deviceId, taskId } = req.params;
    
    console.log(`🗑️ Deleting task ${taskId} for device: ${deviceId}`);
    
    const taskRef = db.collection('tasks').doc(taskId);
    const taskDoc = await taskRef.get();
    
    if (!taskDoc.exists) {
      return res.status(404).json({ error: 'Task not found' });
    }
    
    await taskRef.delete();
    
    console.log(`✅ Task deleted: ${taskId}`);
    
    res.json({
      success: true,
      message: 'Task deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting task:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to delete task',
      details: error.message
    });
  }
});

// ==================== REMOTE DEVICE CONTROL ENDPOINTS ====================

// Remote lock child device
app.post('/api/device/remote-lock', async (req, res) => {
  try {
    const { parentId, childId } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔒 REMOTE DEVICE LOCK REQUEST`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Parent ID: ${parentId}`);
    console.log(`Child ID: ${childId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    if (!parentId || !childId) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields: parentId, childId' });
    }
    
    // Hardcoded parent-child relationship (skip verification for this pair)
    const isHardcodedPair = (parentId === 'azizurgreat111@gmail.com' && childId === '1unknown.annonymous1@gmail.com');
    
    if (!isHardcodedPair) {
      // Verify parent-child relationship for other users
      const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
      
      if (!childDeviceDoc.exists) {
        console.log(`⚠️ Child device not found: ${childId}`);
        console.log(`${'='.repeat(60)}\n`);
        return res.status(404).json({ error: 'Child device not found' });
      }
      
      const linkedParentId = childDeviceDoc.data().linkedTo;
      
      if (linkedParentId !== parentId) {
        console.log(`⚠️ Parent ${parentId} is not linked to child ${childId}`);
        console.log(`${'='.repeat(60)}\n`);
        return res.status(403).json({ error: 'Not authorized to lock this device' });
      }
    } else {
      console.log(`✅ Using hardcoded parent-child relationship`);
    }
    
    console.log(`✅ Parent-child relationship verified`);
    
    // Send lock command notification to child device
    const result = await sendNotificationToUser(
      childId,
      '🔒 Device Locked',
      'Your device has been remotely locked by your parent',
      'device_lock',
      { 
        action: 'lock',
        parentId: parentId,
        timestamp: new Date().toISOString()
      },
      'high',
      parentId
    );
    
    console.log(`✅ Lock command sent to child device`);
    console.log(`   Notification ID: ${result.notificationId}`);
    console.log(`   FCM Message ID: ${result.messageId}`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      message: 'Device lock command sent successfully',
      notificationId: result.notificationId,
      messageId: result.messageId
    });
  } catch (error) {
    console.error(`\n❌ ERROR SENDING REMOTE LOCK COMMAND:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to send remote lock command',
      details: error.message
    });
  }
});

// Remote unlock child device
app.post('/api/device/remote-unlock', async (req, res) => {
  try {
    const { parentId, childId } = req.body;
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔓 REMOTE DEVICE UNLOCK REQUEST`);
    console.log(`${'='.repeat(60)}`);
    console.log(`Parent ID: ${parentId}`);
    console.log(`Child ID: ${childId}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    
    if (!parentId || !childId) {
      console.log(`❌ Missing required fields`);
      console.log(`${'='.repeat(60)}\n`);
      return res.status(400).json({ error: 'Missing required fields: parentId, childId' });
    }
    
    // Hardcoded parent-child relationship (skip verification for this pair)
    const isHardcodedPair = (parentId === 'azizurgreat111@gmail.com' && childId === '1unknown.annonymous1@gmail.com');
    
    if (!isHardcodedPair) {
      // Verify parent-child relationship for other users
      const childDeviceDoc = await db.collection('deviceRegistrations').doc(childId).get();
      
      if (!childDeviceDoc.exists) {
        console.log(`⚠️ Child device not found: ${childId}`);
        console.log(`${'='.repeat(60)}\n`);
        return res.status(404).json({ error: 'Child device not found' });
      }
      
      const linkedParentId = childDeviceDoc.data().linkedTo;
      
      if (linkedParentId !== parentId) {
        console.log(`⚠️ Parent ${parentId} is not linked to child ${childId}`);
        console.log(`${'='.repeat(60)}\n`);
        return res.status(403).json({ error: 'Not authorized to unlock this device' });
      }
    } else {
      console.log(`✅ Using hardcoded parent-child relationship`);
    }
    
    console.log(`✅ Parent-child relationship verified`);
    
    // Send unlock command notification to child device
    const result = await sendNotificationToUser(
      childId,
      '🔓 Device Unlocked',
      'Your device has been remotely unlocked by your parent',
      'device_unlock',
      { 
        action: 'unlock',
        parentId: parentId,
        timestamp: new Date().toISOString()
      },
      'high',
      parentId
    );
    
    console.log(`✅ Unlock command sent to child device`);
    console.log(`   Notification ID: ${result.notificationId}`);
    console.log(`   FCM Message ID: ${result.messageId}`);
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      message: 'Device unlock command sent successfully',
      notificationId: result.notificationId,
      messageId: result.messageId
    });
  } catch (error) {
    console.error(`\n❌ ERROR SENDING REMOTE UNLOCK COMMAND:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    res.status(500).json({
      error: 'Failed to send remote unlock command',
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