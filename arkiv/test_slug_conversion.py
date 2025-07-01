#!/usr/bin/env python3
"""
Test script to verify slug conversion works correctly
"""

import re
from unidecode import unidecode

def key_to_slug(key: str) -> str:
    """Convert examples_meta.json key to website slug"""
    # Remove manufacturer:: prefix and convert to slug format
    if '::' in key:
        _, slug_part = key.split('::', 1)
    else:
        slug_part = key
    
    # Convert to lowercase and replace spaces/special chars with hyphens
    slug = re.sub(r'[^a-z0-9]+', '-', unidecode(slug_part.lower())).strip('-')
    return slug

def test_slugs():
    test_keys = [
        "batstol::mini",
        "batstol::va-mini-gt", 
        "28::c",
        "::52sc",
        "amt::185-r",
        "albin::78-cirrus",
        "albin::cumulus-sprayhood-pa-originalbagar"
    ]
    
    print("Testing slug conversion:")
    for key in test_keys:
        slug = key_to_slug(key)
        url = f"https://www.henricssonsbatkapell.se/exempel/{slug}"
        print(f"  {key} -> {slug}")
        print(f"    URL: {url}")
        print()

if __name__ == "__main__":
    test_slugs() 