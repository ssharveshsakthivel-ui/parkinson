import sqlite3
import os
from werkzeug.security import generate_password_hash

DB_PATH = "neurotrace.db"

def init_db():
    if os.path.exists(DB_PATH):
        print(f"Database {DB_PATH} already exists. Removing to reset...")
        os.remove(DB_PATH)
        
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create Users table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL,
            full_name TEXT NOT NULL
        )
    ''')
    
    # Create mock users
    users = [
        ("dr_smith", generate_password_hash("doctor123"), "doctor", "Dr. Sarah Smith"),
        ("dr_jones", generate_password_hash("doctor123"), "doctor", "Dr. Indiana Jones"),
        ("patient_john", generate_password_hash("patient123"), "patient", "John Doe"),
        ("patient_mary", generate_password_hash("patient123"), "patient", "Mary Jane"),
    ]
    
    cursor.executemany("INSERT INTO users (username, password_hash, role, full_name) VALUES (?, ?, ?, ?)", users)
    
    conn.commit()
    conn.close()
    print("Database initialized successfully with mock Doctor and Patient accounts.")

if __name__ == "__main__":
    init_db()
