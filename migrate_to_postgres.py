#!/usr/bin/env python3
"""
Migration script to move data from JSON files to PostgreSQL database.
Run this once to migrate existing form_submissions.json and form_prompts.json to PostgreSQL.
"""

import os
import json
import sys
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from admin_api_flask import Base, FormSubmission, FormPrompt, DATABASE_URL

def migrate_form_submissions():
    """Migrate form_submissions.json to PostgreSQL."""
    if not os.path.exists('form_submissions.json'):
        print("No form_submissions.json found, skipping migration.")
        return
    
    print("Migrating form_submissions.json to PostgreSQL...")
    
    try:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        
        # Load existing JSON data
        with open('form_submissions.json', 'r', encoding='utf-8') as f:
            submissions = json.load(f)
        
        migrated = 0
        skipped = 0
        
        for sub_data in submissions:
            # Check if already exists
            existing = db.query(FormSubmission).filter_by(id=sub_data['id']).first()
            if existing:
                print(f"  Skipping {sub_data['id']} (already exists)")
                skipped += 1
                continue
            
            # Parse timestamp
            if isinstance(sub_data.get('timestamp'), str):
                timestamp = datetime.fromisoformat(sub_data['timestamp'].replace('Z', '+00:00'))
            else:
                timestamp = datetime.utcnow()
            
            # Create submission
            submission = FormSubmission(
                id=sub_data['id'],
                form_type=sub_data.get('form_type', 'Kontakt'),
                category=sub_data.get('category'),
                title=sub_data.get('title'),
                fields=sub_data.get('fields', {}),
                form_summary=sub_data.get('form_summary', ''),
                proposed_response=sub_data.get('proposed_response', ''),
                timestamp=timestamp,
                status=sub_data.get('status', 'nya-inskick'),
                read=sub_data.get('read', False)
            )
            
            db.add(submission)
            migrated += 1
            print(f"  Migrated {sub_data['id']}")
        
        db.commit()
        db.close()
        
        print(f"✓ Migrated {migrated} submissions, skipped {skipped} duplicates")
        
    except Exception as e:
        print(f"✗ Error migrating form submissions: {e}")
        sys.exit(1)

def migrate_form_prompts():
    """Migrate form_prompts.json to PostgreSQL."""
    if not os.path.exists('form_prompts.json'):
        print("No form_prompts.json found, skipping migration.")
        return
    
    print("Migrating form_prompts.json to PostgreSQL...")
    
    try:
        engine = create_engine(DATABASE_URL, pool_pre_ping=True)
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine)
        db = SessionLocal()
        
        # Load existing JSON data
        with open('form_prompts.json', 'r', encoding='utf-8') as f:
            prompts = json.load(f)
        
        migrated = 0
        updated = 0
        
        for form_type, prompt_text in prompts.items():
            # Check if already exists
            existing = db.query(FormPrompt).filter_by(form_type=form_type).first()
            if existing:
                existing.prompt_text = prompt_text
                existing.updated_at = datetime.utcnow()
                updated += 1
                print(f"  Updated {form_type}")
            else:
                new_prompt = FormPrompt(form_type=form_type, prompt_text=prompt_text)
                db.add(new_prompt)
                migrated += 1
                print(f"  Migrated {form_type}")
        
        db.commit()
        db.close()
        
        print(f"✓ Migrated {migrated} prompts, updated {updated} existing")
        
    except Exception as e:
        print(f"✗ Error migrating form prompts: {e}")
        sys.exit(1)

if __name__ == '__main__':
    print("=" * 60)
    print("PostgreSQL Migration Script")
    print("=" * 60)
    print(f"Database URL: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}")
    print()
    
    migrate_form_submissions()
    print()
    migrate_form_prompts()
    
    print()
    print("=" * 60)
    print("Migration complete!")
    print("=" * 60)
    print("\nNote: JSON files are kept as backup. You can delete them after verifying the migration.")


