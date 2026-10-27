# Hostel Room Cleaning Application - Construction Plan

## Objective
Build a full-stack web application where hostel room residents can request room cleaning, cleaning staff receives requests, and a dual-confirmation workflow marks cleaning as complete. Supports 4 logins per room with duplicate request prevention.

## Architecture Overview
- **Frontend**: React + TypeScript + Vite
- **Backend**: Node.js + Express + TypeScript
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: JWT with role-based access (resident, cleaner, admin)
- **Real-time**: Socket.io for live updates

## Database Schema
```prisma
model User {
  id        String   @id @default(cuid())
  email     String   @unique
  password  String
  name      String
  role      Role     @default(RESIDENT)
  roomId    String?
  room      Room?    @relation(fields: [roomId], references: [id])
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Room {
  id          String   @id @default(cuid())
  number      String   @unique
  building    String
  floor       Int
  capacity    Int      @default(4)
  residents   User[]
  requests    CleaningRequest[]
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model CleaningRequest {
  id          String           @id @default(cuid())
  roomId      String
  room        Room             @relation(fields: [roomId], references: [id])
  requestedBy String
  requester   User             @relation(fields: [requestedBy], references: [id])
  status      CleaningStatus   @default(PENDING)
  cleanerId   String?
  cleaner     User?            @relation("CleanerRequests", fields: [cleanerId], references: [id])
  confirmedBy String?
  confirmer   User?            @relation("ConfirmedRequests", fields: [confirmedBy], references: [id])
  requestedAt DateTime         @default(now())
  cleanedAt   DateTime?
  confirmedAt DateTime?
  createdAt   DateTime         @default(now())
  updatedAt   DateTime         @updatedAt
}

enum Role {
  RESIDENT
  CLEANER
  ADMIN
}

enum CleaningStatus {
  PENDING
  IN_PROGRESS
  CLEANED
  CONFIRMED
  REJECTED
}
```

## Step-by-Step Plan

### Step 1: Project Setup & Infrastructure
**Context**: Initialize monorepo with frontend/backend, configure TypeScript, ESLint, Prettier, Docker
**Tasks**:
- Create project structure with client/server directories
- Setup package.json with workspaces
- Configure TypeScript, ESLint, Prettier
- Create Dockerfile and docker-compose.yml for PostgreSQL
- Setup Prisma schema and initial migration
- Configure environment variables

### Step 2: Authentication System
**Context**: Implement JWT-based auth with registration, login, password hashing, role assignment
**Tasks**:
- Create auth middleware and JWT utilities
- Build register/login endpoints
- Implement password hashing with bcrypt
- Add role-based route protection
- Create auth context and hooks for frontend
- Build login/register pages

### Step 3: Room & User Management
**Context**: Admin can create rooms, assign up to 4 residents per room, manage users
**Tasks**:
- Create room CRUD endpoints
- Implement resident assignment (max 4 per room)
- Build admin dashboard for room management
- Create user profile management
- Add room-resident relationship validation

### Step 4: Cleaning Request Workflow (Resident Side)
**Context**: Residents can request cleaning, view request status, prevent duplicate requests
**Tasks**:
- Create cleaning request endpoint with duplicate check
- Build resident dashboard with request button
- Implement request status polling/real-time updates
- Add request history view
- Prevent duplicate PENDING/IN_PROGRESS requests per room

### Step 5: Cleaner Dashboard & Workflow
**Context**: Cleaners see pending requests, claim requests, mark as cleaned
**Tasks**:
- Create cleaner dashboard with request list
- Implement claim request functionality
- Add "Mark as Cleaned" button
- Real-time updates for new requests
- Cleaner assignment tracking

### Step 6: Dual Confirmation Workflow
**Context**: After cleaner marks cleaned, second person (resident/admin) must confirm
**Tasks**:
- Implement confirmation endpoint
- Add confirmation UI for residents/admins
- Prevent cleaner from confirming their own work
- Email/notification on confirmation needed
- Complete request lifecycle

### Step 7: Real-time Updates & Notifications
**Context**: Socket.io integration for live status updates across all clients
**Tasks**:
- Setup Socket.io server
- Create frontend socket connection hook
- Emit events for request status changes
- Real-time dashboard updates
- Toast notifications

### Step 8: UI Polish & Testing
**Context**: Responsive design, error handling, loading states, E2E tests
**Tasks**:
- Implement responsive UI with Tailwind CSS
- Add loading states and error boundaries
- Write unit tests for critical logic
- Create Playwright E2E tests for full workflow
- Accessibility improvements

## Parallelization Opportunities
- Steps 2 & 3 can run in parallel after Step 1
- Steps 4 & 5 can run in parallel after Steps 2 & 3
- Step 6 depends on Steps 4 & 5
- Step 7 can start after Step 4
- Step 8 runs last

## Verification Commands
- `npm run test` - Unit tests
- `npm run test:e2e` - E2E tests
- `npm run lint` - Linting
- `npm run typecheck` - TypeScript check
- `npm run build` - Production build

## Exit Criteria
- All tests pass (80%+ coverage)
- Full workflow works end-to-end
- No duplicate requests possible
- 4 residents per room enforced
- Dual confirmation required
- Real-time updates functional