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

// Test endpoint to create sample notifications
app.post('/api/test/create-notifications', async (req, res) => {
  try {
    const { userId, deviceType } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }
    
    console.log(`\n🧪 CREATING TEST NOTIFICATIONS FOR: ${userId} (${deviceType})`);
    
    const notifications = [];
    
    if (deviceType === 'child') {
      // Notifications for child from parent
      notifications.push({
        userId: userId,
        title: '📱 New App Limit Set',
        message: 'Your parent has set a 60-minute limit on TikTok',
        type: 'info',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      notifications.push({
        userId: userId,
        title: '🔒 App Blocked',
        message: 'Instagram has been blocked by your parent',
        type: 'warning',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      notifications.push({
        userId: userId,
        title: '✅ Task Assigned',
        message: 'New task: Clean your room',
        type: 'success',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    } else {
      // Notifications for parent from child
      notifications.push({
        userId: userId,
        title: '🚨 SOS Alert',
        message: 'Your child needs immediate help!',
        type: 'sos',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      notifications.push({
        userId: userId,
        title: '📍 Geofence Alert',
        message: 'Your child has left the "Home" safe zone',
        type: 'warning',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      notifications.push({
        userId: userId,
        title: '🔋 Low Battery',
        message: 'Child device battery is at 15%',
        type: 'info',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
      
      notifications.push({
        userId: userId,
        title: '✅ Task Completed',
        message: 'Your child completed: Finish homework',
        type: 'success',
        read: false,
        timestamp: admin.firestore.FieldValue.serverTimestamp()
      });
    }
    
    // Store all notifications
    const batch = db.batch();
    notifications.forEach(notification => {
      const notificationRef = db.collection('notifications').doc();
      batch.set(notificationRef, notification);
    });
    
    await batch.commit();
    
    console.log(`✅ Created ${notifications.length} test notifications for: ${userId}`);
    
    res.json({
      success: true,
      message: `Created ${notifications.length} test notifications`,
      count: notifications.length
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
    
    // Query notifications for this user
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .limit(limit)
      .get();
    
    const notifications = [];
    notificationsSnapshot.forEach(doc => {
      const data = doc.data();
      notifications.push({
        id: doc.id,
        title: data.title,
        message: data.message,
        type: data.type || 'info',
        read: data.read || false,
        timestamp: data.timestamp?.toDate?.()?.toISOString() || new Date().toISOString(),
        userId: data.userId
      });
    });
    
    // Sort in memory instead of in query
    notifications.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    console.log(`\n✅ FOUND ${notifications.length} NOTIFICATIONS`);
    if (notifications.length > 0) {
      console.log(`   Latest notification:`);
      console.log(`      - Title: ${notifications[0].title}`);
      console.log(`      - Type: ${notifications[0].type}`);
      console.log(`      - Read: ${notifications[0].read}`);
      console.log(`      - Time: ${notifications[0].timestamp}`);
    } else {
      console.log(`   💡 No notifications found for this user`);
      console.log(`   💡 Use test endpoint to create sample notifications:`);
      console.log(`      POST /api/test/create-notifications`);
      console.log(`      Body: { "userId": "${userId}", "deviceType": "${deviceType}" }`);
    }
    console.log(`${'='.repeat(60)}\n`);
    
    res.json({
      success: true,
      notifications
    });
  } catch (error) {
    console.error(`\n❌ ERROR FETCHING NOTIFICATIONS:`);
    console.error(error);
    console.log(`${'='.repeat(60)}\n`);
    // Return empty array instead of error to prevent frontend crashes
    res.json({
      success: true,
      notifications: []
    });
  }
});

// Get unread notification count
app.get('/api/notifications/:userId/unread-count', async (req, res) => {
  try {
    const { userId } = req.params;
    
    console.log(`🔔 Fetching unread count for user: ${userId}`);
    
    const notificationsSnapshot = await db.collection('notifications')
      .where('userId', '==', userId)
      .where('read', '==', false)
      .get();
    
    const count = notificationsSnapshot.size;
    
    console.log(`✅ Unread notifications: ${count}`);
    
    res.json({
      success: true,
      count
    });
  } catch (error) {
    console.error('Error fetching unread count:', error);
    res.json({
      success: true,
      count: 0
    });
  }
});

// Mark notification as read
app.put('/api/notifications/:notificationId/read', async (req, res) => {
  try {
    const { notificationId } = req.params;
    
    console.log(`✓ Marking notification as read: ${notificationId}`);
    
    const notificationRef = db.collection('notifications').doc(notificationId);
    const notificationDoc = await notificationRef.get();
    
    if (!notificationDoc.exists) {
      return res.status(404).json({ error: 'Notification not found' });
    }
    
    await notificationRef.update({
      read: true,
      readAt: admin.firestore.FieldValue.serverTimestamp()
    });
    
    console.log(`✅ Notification marked as read: ${notificationId}`);
    
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

    // Send FCM notification
    const response = await admin.messaging().send(message);
    console.log(`✅ SOS notification sent to parent via FCM:`, response);

    // Store notification in database
    const notificationRef = db.collection('notifications').doc();
    await notificationRef.set({
      userId: parentId,
      title: '🚨 EMERGENCY SOS ALERT',
      message: `Your child needs immediate help! ${locationText}`,
      type: 'sos',
      read: false,
      timestamp: admin.firestore.FieldValue.serverTimestamp(),
      childId: childId,
      location: location || null,
    });

    console.log(`✅ SOS notification stored in database`);
    console.log(`${'='.repeat(60)}\n`);

    res.json({
      success: true,
      message: 'SOS alert sent successfully',
      messageId: response,
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

// Create a notification (for testing or internal use)
app.post('/api/notifications', async (req, res) => {
  try {
    const { userId, title, message, type } = req.body;
    
    if (!userId || !title || !message) {
      return res.status(400).json({ error: 'Missing required fields: userId, title, message' });
    }
    
    console.log(`📬 Creating notification for user: ${userId}`);
    
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
    
    console.log(`✅ Notification created: ${notificationRef.id}`);
    
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
    console.error('Error creating notification:', error);
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

// Load devices and families from Firestore on startup
loadDevicesFromFirestore();

// Start server
app.listen(PORT, () => {
  console.log(`🚀 ParentZone backend server running on port ${PORT}`);
  console.log(`📍 Health check: http://localhost:${PORT}/health`);
});