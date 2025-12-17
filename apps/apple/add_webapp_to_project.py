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
WEBAPP_FOLDER_REF = "8A9369640DA44DA696A5D12A"
WEBAPP_FOLDER_BUILD = "C89FD95A485F455F9B5287CA"

# 1. Add folder reference to PBXFileReference section
folder_ref_entry = f'''\t\t{WEBAPP_FOLDER_REF} /* WebApp */ = {{isa = PBXFileReference; lastKnownFileType = folder; name = WebApp; path = JapaneseMaple/WebApp; sourceTree = "<group>"; }};'''

# Find the PBXFileReference section and add our entry
file_ref_section = re.search(r'(/\* Begin PBXFileReference section \*/.*?/\* End PBXFileReference section \*/)', content, re.DOTALL)
if file_ref_section:
    # Add at the end of the section, before "End"
    insert_pos = file_ref_section.group(0).rfind('/* End PBXFileReference section */')
    new_section = file_ref_section.group(0)[:insert_pos] + folder_ref_entry + '\n\t\t' + file_ref_section.group(0)[insert_pos:]
    content = content.replace(file_ref_section.group(0), new_section)
    print("✓ Added WebApp folder reference")
else:
    print("✗ Could not find PBXFileReference section")
    exit(1)

# 2. Add build file to PBXBuildFile section
build_file_entry = f'''\t\t{WEBAPP_FOLDER_BUILD} /* WebApp in Resources */ = {{isa = PBXBuildFile; fileRef = {WEBAPP_FOLDER_REF} /* WebApp */; }};'''

build_file_section = re.search(r'(/\* Begin PBXBuildFile section \*/.*?/\* End PBXBuildFile section \*/)', content, re.DOTALL)
if build_file_section:
    insert_pos = build_file_section.group(0).rfind('/* End PBXBuildFile section */')
    new_section = build_file_section.group(0)[:insert_pos] + build_file_entry + '\n\t\t' + build_file_section.group(0)[insert_pos:]
    content = content.replace(build_file_section.group(0), new_section)
    print("✓ Added WebApp build file")
else:
    print("✗ Could not find PBXBuildFile section")
    exit(1)

# 3. Add to main group's children
# Find the JapaneseMaple group (the one that contains source files)
main_group_pattern = r'(E371627B2EDC1982006A0A2F /\* JapaneseMaple \*/ = \{[^}]*children = \()(.*?)(\);)'
main_group_match = re.search(main_group_pattern, content, re.DOTALL)
if main_group_match:
    children_list = main_group_match.group(2)
    # Add WebApp reference to the children list
    new_children = children_list.rstrip() + f'\n\t\t\t\t{WEBAPP_FOLDER_REF} /* WebApp */,'
    content = content.replace(
        main_group_match.group(0),
        main_group_match.group(1) + new_children + main_group_match.group(3)
    )
    print("✓ Added WebApp to JapaneseMaple group")
else:
    print("✗ Could not find JapaneseMaple group")
    exit(1)

# 4. Add to Resources build phase
resources_pattern = r'(E371628B2EDC1982006A0A2F /\* Resources \*/ = \{[^}]*files = \()(.*?)(\);)'
resources_match = re.search(resources_pattern, content, re.DOTALL)
if resources_match:
    files_list = resources_match.group(2)
    new_files = files_list.rstrip() + f'\n\t\t\t\t{WEBAPP_FOLDER_BUILD} /* WebApp in Resources */,'
    content = content.replace(
        resources_match.group(0),
        resources_match.group(1) + new_files + resources_match.group(3)
    )
    print("✓ Added WebApp to Resources build phase")
else:
    print("✗ Could not find Resources build phase")
    exit(1)

# Write the modified content back
with open(project_file, 'w') as f:
    f.write(content)

print(f"\n✅ Successfully added WebApp folder to Xcode project!")
print(f"Backup saved to: {backup_file}")
print(f"\nNext steps:")
print(f"1. Close Xcode if it's open")
print(f"2. Open the project in Xcode Beta")
print(f"3. Build and run - you should see the custom WebApp UI!")
