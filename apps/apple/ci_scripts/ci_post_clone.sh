#!/bin/sh
# MapleRecorderKit depends on mlx-swift, whose package plug-ins (and swift-syntax
# macros) must be trusted before Xcode will build. Cloud can't answer that prompt
# or take -skipPackagePluginValidation like apple.yml does, so trust them through
# Xcode's defaults instead. (Apple's key really is spelled "Validatation".)
set -eu
defaults write com.apple.dt.Xcode IDESkipPackagePluginFingerprintValidatation -bool YES
defaults write com.apple.dt.Xcode IDESkipMacroFingerprintValidation -bool YES
