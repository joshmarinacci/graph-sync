const EVENT_TYPES = {
    CREATE_OBJECT:'CREATE_OBJECT',
    DELETE_OBJECT:'DELETE_OBJECT',
    CREATE_PROPERTY:'CREATE_PROPERTY',
    SET_PROPERTY:'SET_PROPERTY',
}
let current_id = 0;
function makeGUID() {
    current_id++
    return current_id+''
}

class ObjectSyncProtocol {
    constructor() {
        this.objs = {}
        this.listeners = []
    }
    createObject(objid) {
        const obj = {
            _id:objid?objid:makeGUID()
        }
        if(this.objs[obj._id]) {
            console.log("already exists. don't fire or change")
            return obj._id
        }
        this.objs[obj._id] = obj
        this.fire({type:EVENT_TYPES.CREATE_OBJECT,id:obj._id})
        return obj._id
    }
    deleteObject(objid) {
        const obj = this.getObjectById(objid)
        if(!obj) {
            console.error("no such object exists with id",objid)
            return
        }
        delete this.objs[obj._id]
        this.fire({type:EVENT_TYPES.DELETE_OBJECT,id:obj._id})
    }
    getObjectById(objid) {
        return this.objs[objid]
    }
    createProperty(objid, name, value) {
        const obj = this.getObjectById(objid)
        if(!obj) console.error(`Cannot set property ${name} on object ${objid} that does not exist`)
        if(obj[name]) {
            console.log("property already exists. don't fire or change")
            return
        }
        obj[name] = value
        this.fire({
            type:EVENT_TYPES.CREATE_PROPERTY,
            object:objid,
            name:name,
            value:value
        })
    }
    setProperty(objid,name,value) {
        const obj = this.getObjectById(objid)
        if(obj[name] === value) {
            console.log("property already has this value, don't fire or change")
            return
        }
        obj[name] = value
        this.fire({
            type:EVENT_TYPES.SET_PROPERTY,
            object:objid,
            name:name,
            value:value
        })
    }

    onChange(cb) {
        this.listeners.push(cb)
    }
    fire(event) {
        this.listeners.forEach(cb => cb(event))
    }

    getObjectByProperty(key,value) {
        for(let id in this.objs) {
            const obj = this.objs[id]
            // console.log('obj',id,':',obj)
            // console.log("checking",key,value)
            if(obj[key] === value) return obj._id
        }
        return null
    }

    getPropertiesForObject(objid) {
        return Object.keys(this.getObjectById(objid)).filter(key => key !== '_id')
    }
    getPropertyValue(objid, key) {
        return this.getObjectById(objid)[key]
    }

    dumpGraph() {
        const graph = {}
        Object.keys(this.objs).forEach(key => {
            const obj = this.objs[key]
            let id = obj._id
            if(obj.id) id = obj.id
            graph[id] = {}
            Object.keys(obj).forEach(key => {
                if(key === '_id' && obj.id) {
                    graph[id]['id'] = obj.id
                } else {
                    graph[id][key] = obj[key]
                }
            })
        })
        return graph
    }
}

module.exports.ObjectSyncProtocol = ObjectSyncProtocol
Object.keys(EVENT_TYPES).forEach(key => {
    module.exports[key] = EVENT_TYPES[key]
})
