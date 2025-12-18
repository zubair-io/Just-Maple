#!/bin/bash

# Test Push Notification Script
# This script sends test push notifications to your device using APNs

# Configuration
TEAM_ID="YOUR_TEAM_ID"
KEY_ID="YOUR_KEY_ID"
AUTH_KEY_PATH="./AuthKey_${KEY_ID}.p8"
BUNDLE_ID="com.just.maple.JapaneseMaple"
DEVICE_TOKEN="YOUR_DEVICE_TOKEN"
APNS_SERVER="api.sandbox.push.apple.com"  # Use api.push.apple.com for production

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if dependencies are installed
if ! command -v curl &> /dev/null; then
    echo -e "${RED}curl is not installed${NC}"
    exit 1
fi

if ! command -v openssl &> /dev/null; then
    echo -e "${RED}openssl is not installed${NC}"
    exit 1
fi

# Function to generate JWT token
generate_jwt() {
    local header='{"alg":"ES256","kid":"'$KEY_ID'"}'
    local payload='{"iss":"'$TEAM_ID'","iat":'$(date +%s)'}'
    
    local header_b64=$(echo -n "$header" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
    local payload_b64=$(echo -n "$payload" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
    local data="$header_b64.$payload_b64"
    
    local signature=$(echo -n "$data" | openssl dgst -sha256 -sign "$AUTH_KEY_PATH" | openssl base64 -e -A | tr '+/' '-_' | tr -d '=')
    
    echo "$data.$signature"
}

# Function to send push notification
send_push() {
    local payload=$1
    local description=$2
    
    echo -e "${YELLOW}Sending: $description${NC}"
    
    local jwt=$(generate_jwt)
    
    curl -v \
        --http2 \
        --header "authorization: bearer $jwt" \
        --header "apns-topic: $BUNDLE_ID" \
        --header "apns-priority: 10" \
        --header "apns-push-type: alert" \
        --data "$payload" \
        "https://${APNS_SERVER}:443/3/device/${DEVICE_TOKEN}"
    
    echo -e "\n${GREEN}Sent: $description${NC}\n"
    sleep 2
}

# Check configuration
if [[ "$TEAM_ID" == "YOUR_TEAM_ID" ]]; then
    echo -e "${RED}Please configure TEAM_ID in the script${NC}"
    exit 1
fi

if [[ "$KEY_ID" == "YOUR_KEY_ID" ]]; then
    echo -e "${RED}Please configure KEY_ID in the script${NC}"
    exit 1
fi

if [[ "$DEVICE_TOKEN" == "YOUR_DEVICE_TOKEN" ]]; then
    echo -e "${RED}Please configure DEVICE_TOKEN in the script${NC}"
    exit 1
fi

if [[ ! -f "$AUTH_KEY_PATH" ]]; then
    echo -e "${RED}Auth key file not found: $AUTH_KEY_PATH${NC}"
    exit 1
fi

echo -e "${GREEN}Starting Push Notification Tests${NC}\n"

# Test 1: Basic notification with mutable-content
send_push '{
  "aps": {
    "alert": {
      "title": "Basic Test",
      "body": "This is a basic notification with mutable content"
    },
    "mutable-content": 1,
    "sound": "default"
  },
  "notificationId": "test-001",
  "serverKey": "test-server-key",
  "type": "test"
}' "Basic notification with mutable-content"

# Test 2: Notification with image attachment
send_push '{
  "aps": {
    "alert": {
      "title": "Image Test",
      "body": "This notification should have an image attachment"
    },
    "mutable-content": 1,
    "sound": "default"
  },
  "notificationId": "test-002",
  "serverKey": "test-server-key",
  "type": "test",
  "imageUrl": "https://picsum.photos/400/300"
}' "Notification with image attachment"

# Test 3: Notification without mutable-content (should bypass extension)
send_push '{
  "aps": {
    "alert": {
      "title": "Non-Mutable Test",
      "body": "This notification does not have mutable-content"
    },
    "sound": "default"
  },
  "notificationId": "test-003",
  "type": "test"
}' "Notification without mutable-content (bypass extension)"

# Test 4: Notification with badge update
send_push '{
  "aps": {
    "alert": {
      "title": "Badge Test",
      "body": "This notification updates the badge count"
    },
    "mutable-content": 1,
    "badge": 5,
    "sound": "default"
  },
  "notificationId": "test-004",
  "serverKey": "test-server-key",
  "type": "test"
}' "Notification with badge count"

# Test 5: Silent notification (content-available)
send_push '{
  "aps": {
    "content-available": 1
  },
  "notificationId": "test-005",
  "serverKey": "test-server-key",
  "type": "silent",
  "data": {
    "action": "sync"
  }
}' "Silent notification (content-available)"

echo -e "${GREEN}All tests completed!${NC}"
echo -e "${YELLOW}Check your device and Console.app logs for results${NC}"
