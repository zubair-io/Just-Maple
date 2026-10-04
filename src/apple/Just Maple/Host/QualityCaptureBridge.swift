import Foundation
import MapleCore

extension Bridge {
    func qualityCaptureCommand(_ body:[String:Any])async throws->Any {
        guard model.loaded,let store=model.store else {throw MapleError.invalid("Wait for the local workspace to load before capturing.")}
        // This query never polls a connector, refreshes the world, or starts a provider.
        _ = try string(body,"worldJSON",limit:32*1024*1024)
        _ = try string(body,"projectionJSON",limit:8*1024*1024)
        let request=try JSONCodec.decode(QualityCaptureRequest.self,from:JSONSerialization.data(withJSONObject:body))
        return try json(try await store.captureQualitySnapshot(request,expectedWorld:model.world,directory:model.directory.appendingPathComponent("QualityCaptures",isDirectory:true)))
    }
}
