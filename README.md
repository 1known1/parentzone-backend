# ParentZone Backend - Clean Deployment

This is a clean version of the ParentZone backend without any hardcoded secrets.

## Deployment to Render

1. **Push this repository to GitHub**
2. **Connect to Render**
3. **Set environment variable:**
   - `FIREBASE_SERVICE_ACCOUNT_BASE64` = [your base64 encoded Firebase credentials]

## Environment Variables Required

- `NODE_ENV=production`
- `PORT=10000`
- `FIREBASE_SERVICE_ACCOUNT_BASE64=[base64 encoded Firebase service account JSON]`

## Base64 Credentials

To get your base64 credentials, run this command locally:

```bash
# Convert your Firebase JSON file to base64
node -e "const fs = require('fs'); const data = fs.readFileSync('./your-firebase-file.json', 'utf8'); console.log(Buffer.from(data).toString('base64'));"
```

Then set the output as the `FIREBASE_SERVICE_ACCOUNT_BASE64` environment variable in Render.

## Security

- No hardcoded credentials
- All sensitive data via environment variables
- Firebase service account files excluded from git"# ParentZone-B" 
