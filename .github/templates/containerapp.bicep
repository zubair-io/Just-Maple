@description('Name of the container app')
param containerAppName string

@description('Location for resources')
param location string = resourceGroup().location

@description('Container Apps Environment ID')
param environmentId string

@description('Container image to deploy')
param imageTag string

@description('Container registry server')
param registryServer string

@description('Container registry username')
param registryUsername string

@secure()
@description('Container registry password')
param registryPassword string

@secure()
@description('JWT secret for authentication')
param jwtSecret string = 'preview-jwt-secret-placeholder'

@description('Revision suffix to force new deployment (use commit SHA)')
param revisionSuffix string = ''

resource containerApp 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
  location: location
  properties: {
    environmentId: environmentId
    configuration: {
      ingress: {
        external: true
        targetPort: 7071
      }
      registries: [
        {
          server: registryServer
          username: registryUsername
          passwordSecretRef: 'registry-password'
        }
      ]
      secrets: [
        {
          name: 'registry-password'
          value: registryPassword
        }
        {
          name: 'jwt-secret'
          value: jwtSecret
        }
      ]
    }
    template: {
      revisionSuffix: revisionSuffix != '' ? revisionSuffix : null
      containers: [
        {
          name: 'api'
          image: imageTag
          resources: {
            cpu: json('0.5')
            memory: '1Gi'
          }
          env: [
            {
              name: 'MONGODB_URI'
              value: 'mongodb://localhost:27017/justmaple'
            }
            {
              name: 'REDIS_URL'
              value: 'redis://localhost:6379'
            }
            {
              name: 'JWT_SECRET'
              secretRef: 'jwt-secret'
            }
          ]
        }
        {
          name: 'mongodb'
          image: 'docker.io/library/mongo:7'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
        {
          name: 'redis'
          image: 'docker.io/library/redis:7-alpine'
          resources: {
            cpu: json('0.25')
            memory: '0.5Gi'
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 1
      }
    }
  }
}

output fqdn string = containerApp.properties.configuration.ingress.fqdn
