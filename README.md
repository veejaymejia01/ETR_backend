# Healthcare Portal Full Project

## Frontend
Open or deploy the files in `frontend/`:
- login.html
- admin-dashboard.html
- doctor-dashboard.html
- style.css
- auth.js
- admin.js
- doctor.js

## Backend
Deploy the files in `backend/`:
- package.json
- server.js
- render.yaml
- .env.example

## Demo credentials
Admin:
- admin@hospital.com / admin123

Doctor:
- doctor@hospital.com / doctor123

## Connect frontend to backend
After backend deployment, replace `const API = 'http://localhost:3000/api';`
in:
- frontend/auth.js
- frontend/admin.js
- frontend/doctor.js

with your live backend URL, for example:
`const API = 'https://your-backend-name.onrender.com/api';`
