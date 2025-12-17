#!/usr/bin/env python3
import re
import shutil
from datetime import datetime

# Backup the project file
project_file = 'JapaneseMaple.xcodeproj/project.pbxproj'
backup_file = f'{project_file}.backup.{datetime.now().strftime("%Y%m%d_%H%M%S")}'
shutil.copy(project_file, backup_file)
print(f"Created backup: {backup_file}")

# Read the project file
with open(project_file, 'r') as f:
    content = f.read()

# UUIDs
PACKAGE_REF = "7461055901DA42F78BE46662"
PACKAGE_PRODUCT = "26495016164A4B7D820F1D18"

# 1. Add XCRemoteSwiftPackageReference section (if it doesn't exist)
if 'XCRemoteSwiftPackageReference' not in content:
    # Find where to insert - after the last "End" section before the root object
    insert_pattern = r'(/\* End XCConfigurationList section \*/)'
    match = re.search(insert_pattern, content)

    if match:
        package_ref_section = f'''
/* Begin XCRemoteSwiftPackageReference section */
\t\t{PACKAGE_REF} /* XCRemoteSwiftPackageReference "WhisperKit" */ = {{
\t\t\tisa = XCRemoteSwiftPackageReference;
\t\t\trepositoryURL = "https://github.com/argmaxinc/WhisperKit";
\t\t\trequirement = {{
\t\t\t\tkind = upToNextMajorVersion;
\t\t\t\tminimumVersion = 0.7.0;
\t\t\t}};
\t\t}};
/* End XCRemoteSwiftPackageReference section */
'''
        content = content.replace(match.group(0), match.group(0) + package_ref_section)
        print("✓ Added XCRemoteSwiftPackageReference section")

# 2. Add XCSwiftPackageProductDependency section
if 'XCSwiftPackageProductDependency' not in content:
    # Find where to insert
    insert_pattern = r'(/\* End XCRemoteSwiftPackageReference section \*/)'
    match = re.search(insert_pattern, content)

    if match:
        package_product_section = f'''
/* Begin XCSwiftPackageProductDependency section */
\t\t{PACKAGE_PRODUCT} /* WhisperKit */ = {{
\t\t\tisa = XCSwiftPackageProductDependency;
\t\t\tpackage = {PACKAGE_REF} /* XCRemoteSwiftPackageReference "WhisperKit" */;
\t\t\tproductName = WhisperKit;
\t\t}};
/* End XCSwiftPackageProductDependency section */
'''
        content = content.replace(match.group(0), match.group(0) + package_product_section)
        print("✓ Added XCSwiftPackageProductDependency section")

# 3. Add package reference to the project
# Find the PBXProject section and add packageReferences
project_pattern = r'(E37162712EDC1981006A0A2F /\* Project object \*/ = \{[^}]*productRefGroup = [^;]*;)'
match = re.search(project_pattern, content, re.DOTALL)
if match:
    # Add packageReferences array before the closing of the project object
    insert_text = match.group(0) + f'''
\t\t\t\tpackageReferences = (
\t\t\t\t\t{PACKAGE_REF} /* XCRemoteSwiftPackageReference "WhisperKit" */,
\t\t\t\t);'''
    content = content.replace(match.group(0), insert_text)
    print("✓ Added packageReferences to project")

# 4. Add package product to the target's dependencies
# Find the JapaneseMaple target and add to packageProductDependencies
target_pattern = r'(E37162722EDC1981006A0A2F /\* JapaneseMaple \*/ = \{[^}]*productName = JapaneseMaple;)'
match = re.search(target_pattern, content, re.DOTALL)
if match:
    insert_text = match.group(0) + f'''
\t\t\t\tpackageProductDependencies = (
\t\t\t\t\t{PACKAGE_PRODUCT} /* WhisperKit */,
\t\t\t\t);'''
    content = content.replace(match.group(0), insert_text)
    print("✓ Added packageProductDependencies to JapaneseMaple target")

# Write the modified content
with open(project_file, 'w') as f:
    f.write(content)

print(f"\n✅ Successfully added WhisperKit package to project!")
print(f"Backup saved to: {backup_file}")
print(f"\nNext: Uncomment WhisperKit code in TranscriptionService.swift")
