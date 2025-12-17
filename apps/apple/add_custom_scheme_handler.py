#!/usr/bin/env python3
import re
import shutil
from datetime import datetime

# Backup the project file first
project_file = 'JapaneseMaple.xcodeproj/project.pbxproj'
backup_file = f'{project_file}.backup.{datetime.now().strftime("%Y%m%d_%H%M%S")}'
shutil.copy(project_file, backup_file)
print(f"Created backup: {backup_file}")

# Read the project file
with open(project_file, 'r') as f:
    content = f.read()

# UUIDs for new entries
CUSTOM_SCHEME_FILE_REF = "9B8F7A3C1FE945A892D6C15E"
CUSTOM_SCHEME_BUILD = "7D6E5B2A8CF34D1B9A4F8C3D"

# 1. Add file reference to PBXFileReference section
file_ref_entry = f'''\t\t{CUSTOM_SCHEME_FILE_REF} /* CustomSchemeHandler.swift */ = {{isa = PBXFileReference; lastKnownFileType = sourcecode.swift; path = CustomSchemeHandler.swift; sourceTree = "<group>"; }};'''

# Find the PBXFileReference section and add our entry
file_ref_section = re.search(r'(/\* Begin PBXFileReference section \*/.*?/\* End PBXFileReference section \*/)', content, re.DOTALL)
if file_ref_section:
    # Add at the end of the section, before "End"
    insert_pos = file_ref_section.group(0).rfind('/* End PBXFileReference section */')
    new_section = file_ref_section.group(0)[:insert_pos] + file_ref_entry + '\n\t\t' + file_ref_section.group(0)[insert_pos:]
    content = content.replace(file_ref_section.group(0), new_section)
    print("✓ Added CustomSchemeHandler.swift file reference")
else:
    print("✗ Could not find PBXFileReference section")
    exit(1)

# 2. Add build file to PBXBuildFile section
build_file_entry = f'''\t\t{CUSTOM_SCHEME_BUILD} /* CustomSchemeHandler.swift in Sources */ = {{isa = PBXBuildFile; fileRef = {CUSTOM_SCHEME_FILE_REF} /* CustomSchemeHandler.swift */; }};'''

build_file_section = re.search(r'(/\* Begin PBXBuildFile section \*/.*?/\* End PBXBuildFile section \*/)', content, re.DOTALL)
if build_file_section:
    insert_pos = build_file_section.group(0).rfind('/* End PBXBuildFile section */')
    new_section = build_file_section.group(0)[:insert_pos] + build_file_entry + '\n\t\t' + build_file_section.group(0)[insert_pos:]
    content = content.replace(build_file_section.group(0), new_section)
    print("✓ Added CustomSchemeHandler.swift build file")
else:
    print("✗ Could not find PBXBuildFile section")
    exit(1)

# 3. Add to main group's children
main_group_pattern = r'(E371627B2EDC1982006A0A2F /\* JapaneseMaple \*/ = \{[^}]*children = \()(.*?)(\);)'
main_group_match = re.search(main_group_pattern, content, re.DOTALL)
if main_group_match:
    children_list = main_group_match.group(2)
    # Add CustomSchemeHandler reference to the children list
    new_children = children_list.rstrip() + f'\n\t\t\t\t{CUSTOM_SCHEME_FILE_REF} /* CustomSchemeHandler.swift */,'
    content = content.replace(
        main_group_match.group(0),
        main_group_match.group(1) + new_children + main_group_match.group(3)
    )
    print("✓ Added CustomSchemeHandler.swift to JapaneseMaple group")
else:
    print("✗ Could not find JapaneseMaple group")
    exit(1)

# 4. Add to Sources build phase
sources_pattern = r'(E3716288\w* /\* Sources \*/ = \{[^}]*files = \()(.*?)(\);)'
sources_match = re.search(sources_pattern, content, re.DOTALL)
if sources_match:
    files_list = sources_match.group(2)
    new_files = files_list.rstrip() + f'\n\t\t\t\t{CUSTOM_SCHEME_BUILD} /* CustomSchemeHandler.swift in Sources */,'
    content = content.replace(
        sources_match.group(0),
        sources_match.group(1) + new_files + sources_match.group(3)
    )
    print("✓ Added CustomSchemeHandler.swift to Sources build phase")
else:
    print("✗ Could not find Sources build phase")
    exit(1)

# Write the modified content back
with open(project_file, 'w') as f:
    f.write(content)

print(f"\n✅ Successfully added CustomSchemeHandler.swift to Xcode project!")
print(f"Backup saved to: {backup_file}")
print(f"\nNext steps:")
print(f"1. Build the macOS app")
print(f"2. The app should now load via app://localhost/ with full Angular Router support!")
