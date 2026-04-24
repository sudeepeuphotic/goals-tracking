# AWS Deployment Plan (Scalable)

This repository now supports two production deployment patterns:

1. **AWS App Runner** (recommended first step: managed, autoscaling, simpler ops)
2. **EC2 + Docker** (more control, more operational ownership)

MongoDB should be hosted on **MongoDB Atlas**.

## 1) Target Architecture

- Frontend: React app on App Runner (or EC2 + Nginx)
- Backend: FastAPI container on App Runner (or EC2 + Docker)
- Database: MongoDB Atlas cluster
- Auth: AWS Cognito (email/password user pool)

## 2) Environment Variables

### Backend required

- `MONGO_URL` (MongoDB Atlas connection string)
- `DB_NAME`
- `JWT_SECRET` (still used for app-session tokens)
- `FRONTEND_URL`
- `CORS_ORIGINS` (comma-separated list)
- `COGNITO_ENABLED=true`
- `COGNITO_REGION`
- `COGNITO_CLIENT_ID`
- `COGNITO_USER_POOL_ID`
- `COGNITO_ROLE_ATTRIBUTE` (default: `custom:role`)
- `COGNITO_GROUP_ROLE_MAP` (JSON, e.g. `{"admins":"admin","managers":"manager","dris":"dri","contributors":"contributor"}`)

### Frontend required

- `REACT_APP_BACKEND_URL` (backend base URL, no trailing `/api`)
- `REACT_APP_COGNITO_USER_POOL_ID`
- `REACT_APP_COGNITO_CLIENT_ID`

## 3) App Runner Deployment

### Backend service

Use `backend/apprunner.yaml` and deploy from the `backend` folder.

- Runtime command: `uvicorn server:app --host 0.0.0.0 --port 8000`
- Port: `8000`
- Configure health check path: `/api/`
- Configure autoscaling based on request concurrency

### Frontend service

Use `frontend/apprunner.yaml` and deploy from the `frontend` folder.

- Runtime command: `npx serve -s build -l 3000`
- Port: `3000`

## 4) EC2 Deployment (Alternative)

### Backend

```bash
docker build -t goals-backend ./backend
docker run -d --name goals-backend -p 8000:8000 \
  -e MONGO_URL="mongodb+srv://goals_db_user:Euphotic@1@goals-tracking.bdpdrtq.mongodb.net/?appName=goals-tracking" \
  -e DB_NAME="goals-tracking" \
  -e JWT_SECRET="..." \
  -e FRONTEND_URL="https://<frontend-domain>" \
  -e CORS_ORIGINS="https://<frontend-domain>" \
  -e COGNITO_ENABLED="true" \
  -e COGNITO_REGION="ap-south-1" \
  -e COGNITO_CLIENT_ID="5ok4khhs8a1rrm833l9uhv7d9e" \
  goals-backend
```

### Frontend

```bash
docker build -t goals-frontend ./frontend
docker run -d --name goals-frontend -p 80:80 goals-frontend
```

## 5) Cognito Migration Notes

Backend now supports Cognito-based authentication:

- `POST /api/auth/login` validates email/password against Cognito when `COGNITO_ENABLED=true`
- New Cognito users are auto-provisioned into `users` collection (default role: `contributor`)
- Backend still issues its existing access/refresh cookies so existing frontend flow remains compatible during migration
- Bearer tokens from Cognito are accepted by backend auth middleware via `GetUser`

Recommended next step on frontend:

- Replace custom auth context login with Cognito SDK (`amazon-cognito-identity-js` or Amplify Auth)
- Keep calling backend APIs with bearer token or session cookie

## 6) MongoDB Atlas Checklist

- Create Atlas cluster + database user
- Allow inbound IPs from App Runner VPC connector / EC2 security groups
- Set TLS-enabled connection string in `MONGO_URL`
- Add indexes and backups (point-in-time backup for production)

