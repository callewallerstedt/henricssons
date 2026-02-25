# PostgreSQL Database Setup

## Using Neon PostgreSQL (Recommended)

This project is configured to use **Neon PostgreSQL** (serverless PostgreSQL).

### Quick Setup

1. **Create the database in Neon:**
   - Option A: Run the script:
     ```bash
     python create_database.py
     ```
   - Option B: Manual creation:
     - Go to https://console.neon.tech
     - Select your project
     - Click "Create Database"
     - Name it `henricssons`

2. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

3. **The connection string is already configured!** Just start the server:
   ```bash
   python admin_api_flask.py
   ```

The database tables will be created automatically on first run.

### Connection String

The default connection string is:
```
postgresql://neondb_owner:npg_Civd6EGpRtI3@ep-round-night-a94iem80-pooler.gwc.azure.neon.tech/henricssons?sslmode=require&channel_binding=require
```

You can override it with the `DATABASE_URL` environment variable if needed.

---

## Local PostgreSQL Setup (Alternative)

### 1. Install PostgreSQL

**Windows:**
- Download from https://www.postgresql.org/download/windows/
- Install with default settings
- Remember the password you set for the `postgres` user

**macOS:**
```bash
brew install postgresql
brew services start postgresql
```

**Linux (Ubuntu/Debian):**
```bash
sudo apt-get update
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### 2. Create Database

```bash
# Connect to PostgreSQL
psql -U postgres

# Create database
CREATE DATABASE henricssons;

# Create user (optional, or use postgres user)
CREATE USER henricssons_user WITH PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE henricssons TO henricssons_user;

# Exit
\q
```

### 3. Set Environment Variable

**Windows (PowerShell):**
```powershell
$env:DATABASE_URL="postgresql://postgres:your_password@localhost/henricssons"
```

**Windows (Permanent):**
1. System Properties → Environment Variables
2. Add new variable:
   - Name: `DATABASE_URL`
   - Value: `postgresql://postgres:your_password@localhost/henricssons`

**macOS/Linux:**
```bash
export DATABASE_URL="postgresql://postgres:your_password@localhost/henricssons"
```

Or add to `~/.bashrc` or `~/.zshrc`:
```bash
echo 'export DATABASE_URL="postgresql://postgres:your_password@localhost/henricssons"' >> ~/.bashrc
```

### 4. Install Python Dependencies

```bash
pip install -r requirements.txt
```

### 5. Run Migration (Optional)

If you have existing data in `form_submissions.json`:

```bash
python migrate_to_postgres.py
```

### 6. Start Server

The database tables will be created automatically when you start the server:

```bash
python admin_api_flask.py
```

## Production (Render/Heroku)

Set the `DATABASE_URL` environment variable in your hosting platform. It should be in the format:
```
postgresql://user:password@host:port/database
```

For Render, you can add a PostgreSQL database service and it will automatically provide a `DATABASE_URL` environment variable.

## Fallback Behavior

If PostgreSQL is not available, the system will automatically fall back to JSON file storage. This ensures the application continues to work even if the database is down.

