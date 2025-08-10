# PostgreSQL Database Setup - Shopify Wishlist App

## 🗄️ Database Configuration

### Connection Details
- **Database Name:** `wishlist_app`
- **Username:** `wishlist_user`
- **Password:** `wishlist_password`
- **Host:** `localhost`
- **Port:** `5432`
- **Schema:** `public`

### Connection String
```
DATABASE_URL=postgresql://wishlist_user:wishlist_password@localhost:5432/wishlist_app?schema=public
```

## 🔧 Setup Commands

### 1. Install PostgreSQL
```bash
sudo apt-get update && sudo apt-get install -y postgresql postgresql-contrib
```

### 2. Create Database
```bash
sudo -u postgres createdb wishlist_app
```

### 3. Create User
```bash
sudo -u postgres psql -c "CREATE USER wishlist_user WITH PASSWORD 'wishlist_password';"
```

### 4. Grant Permissions
```bash
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE wishlist_app TO wishlist_user;"
sudo -u postgres psql -c "ALTER USER wishlist_user CREATEDB;"
sudo -u postgres psql -d wishlist_app -c "GRANT ALL ON SCHEMA public TO wishlist_user;"
sudo -u postgres psql -d wishlist_app -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO wishlist_user;"
```

### 5. Update Prisma Schema
```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 6. Run Migration
```bash
rm -rf prisma/migrations  # Remove old SQLite migrations
npx prisma migrate dev --name init
```

## 📊 Database Schema

### Tables Created
1. **Shop** - Store information
   - `id` (String, Primary Key)
   - `domain` (String, Unique)
   - `accessToken` (String)
   - `installedAt` (DateTime)

2. **Customer** - Customer data
   - `id` (String, Primary Key)
   - `shopId` (String, Foreign Key)
   - `shopCustomerId` (BigInt)
   - `email` (String, Optional)
   - `createdAt` (DateTime)

3. **Wishlist** - Wishlist containers
   - `id` (String, Primary Key)
   - `shopId` (String, Foreign Key)
   - `customerId` (String, Foreign Key, Optional)
   - `shareUUID` (String, Unique)
   - `createdAt` (DateTime)

4. **WishlistItem** - Individual wishlist items
   - `id` (String, Primary Key)
   - `wishlistId` (String, Foreign Key)
   - `productId` (BigInt)
   - `variantId` (BigInt)
   - `handle` (String)
   - `createdAt` (DateTime)

5. **Event** - Activity tracking
   - `id` (String, Primary Key)
   - `shopId` (String, Foreign Key)
   - `customerId` (String, Foreign Key, Optional)
   - `type` (String)
   - `payload` (Json)
   - `createdAt` (DateTime)

## 🔗 Relationships
- **Shop** → **Customer** (One-to-Many)
- **Shop** → **Wishlist** (One-to-Many)
- **Shop** → **Event** (One-to-Many)
- **Customer** → **Wishlist** (One-to-Many)
- **Customer** → **Event** (One-to-Many)
- **Wishlist** → **WishlistItem** (One-to-Many)

## 🚀 Environment Variables

### .env Configuration
```env
# Database Configuration
DATABASE_URL=postgresql://wishlist_user:wishlist_password@localhost:5432/wishlist_app?schema=public

# App URLs
HOST=http://localhost:3457
APPLICATION_URL=http://localhost:3457

# Server Configuration
PORT=3000
BACKEND_PORT=3000
FRONTEND_PORT=3001

# Environment
NODE_ENV=development
```

## 🔍 Useful Commands

### Check Database Status
```bash
sudo systemctl status postgresql
```

### Connect to Database
```bash
psql -h localhost -U wishlist_user -d wishlist_app
```

### View Tables
```sql
\dt
```

### Reset Database (Development)
```bash
npx prisma migrate reset
```

### Generate Prisma Client
```bash
npx prisma generate
```

## 📝 Notes
- Database created on: August 10, 2025
- Migration: `20250810213106_init`
- Prisma Client Version: 6.13.0
- PostgreSQL Version: 16+257build1.1

## 🔒 Security Notes
- This is a development setup
- For production, use stronger passwords
- Consider using environment variables for sensitive data
- Enable SSL connections for production deployments 