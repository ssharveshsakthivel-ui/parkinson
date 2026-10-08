from supabase import create_client, Client
import sys

url = "https://rglnzkvkubmdkzydosdb.supabase.co"
key = "sb_publishable_GbcxEI4te1bUNquuzvCVLg_mBvqSHr7"
supabase: Client = create_client(url, key)

print(hasattr(supabase.auth, 'get_user'))
try:
    print(supabase.auth.get_user)
except Exception as e:
    print(e)
