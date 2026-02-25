#!/usr/bin/env python3
"""
Script to create the 'henricssons' database in Neon.
This connects to the default 'neondb' database first, then creates a new database.
"""

import os

import psycopg2
from psycopg2.extensions import ISOLATION_LEVEL_AUTOCOMMIT

# Connection to a maintenance DB used to create the target database.
# Set this in your environment, for example:
#   DATABASE_ADMIN_URL=postgresql://user:pass@host/neondb?sslmode=require
CONNECTION_STRING = os.getenv('DATABASE_ADMIN_URL')

def create_database():
    """Create henricssons database in Neon."""
    if not CONNECTION_STRING:
        print("Missing DATABASE_ADMIN_URL environment variable.")
        print("Set DATABASE_ADMIN_URL to a maintenance DB connection string and run again.")
        return
    try:
        # Connect to default database
        conn = psycopg2.connect(CONNECTION_STRING)
        conn.set_isolation_level(ISOLATION_LEVEL_AUTOCOMMIT)
        cursor = conn.cursor()
        
        # Check if database exists
        cursor.execute("SELECT 1 FROM pg_database WHERE datname = 'henricssons'")
        exists = cursor.fetchone()
        
        if exists:
            print("Database 'henricssons' already exists!")
        else:
            # Create new database
            cursor.execute('CREATE DATABASE henricssons')
            print("Database 'henricssons' created successfully!")
        
        cursor.close()
        conn.close()
        
        print("\nDatabase created. Configure your app DATABASE_URL for the new database.")
        
    except psycopg2.errors.DuplicateDatabase:
        print("Database 'henricssons' already exists!")
    except Exception as e:
        print(f"Error creating database: {e}")
        print("\nYou can also create it manually in Neon Dashboard:")
        print("1. Go to https://console.neon.tech")
        print("2. Select your project")
        print("3. Click 'Create Database'")
        print("4. Name it 'henricssons'")

if __name__ == '__main__':
    print("Creating 'henricssons' database in Neon...")
    create_database()
