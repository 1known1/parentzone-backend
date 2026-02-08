require('dotenv').config();
const express = require('express');
const cors = require('cors');
const admin = require('firebase-admin');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware - CORS configuration
const allowedOrigins = [
  'https://parentzone.onrender.com',
  'https://parentzone-frontend.onrender.com'
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

// Get device data from Firestore
app.get('/api/device/:deviceId/data', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    console.log(`📥 Fetching data for device: ${deviceId}`);

    const deviceDoc = await db.collection('devices').doc(deviceId).get();

    if (!deviceDoc.exists) {
      console.log(`⚠️ Device not found: ${deviceId}`);
      return res.status(404).json({ 
        success: false,
        error: 'Device not found',
        message: 'No data available for this device yet'
      });
    }

    const deviceData = deviceDoc.data();
    console.log(`✅ Data retrieved for: ${deviceId}`);

    res.json({
      success: true,
      data: deviceData,
      deviceId
    });
  } catch (error) {
    console.error('Error fetching device data:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch device data',
      details: error.message
    });
  }
});

// ==================== TASK ENDPOINTS ====================

// Get tasks for a device
app.get('/api/device/:deviceId/tasks', async (req, res) => {
  try {
    const { deviceId } = req.params;
    console.log(`📋 Fetching tasks for device: ${deviceId}`);
    
    const tasksSnapshot = await db.collection('tasks')
      .where('deviceId', '==', deviceId)
      .orderBy('createdAt', 'desc')
      .get();
    
    const tasks = [];
    tasksSnapshot.forEach(doc => {
      const data = doc.data();
      tasks.push({
        id: doc.id,
        text: data.text,
        completed: data.completed || false,
        deviceId: data.deviceId,
        parentId: data.parentId,
        createdAt: data.createdAt?.toDate?.()?.toISOString() || new Date().toISOString(),
        updatedAt: data.updatedAt?.toDate?.()?.toISOString() || new Date().toISOString()
      });
    });
    
    console.log(`✅ Found ${tasks.length} tasks for device: ${deviceId}`);
    
    res.json({
      success: true,
      tasks
    });
  } catch (error) {
    console.error('Error fetching tasks:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to fetch tasks',
      details: error.message
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